//! The daemon's HTTP surface: `/health`, the auth/ceiling middleware, the
//! CSP/framing headers, and the static remote-UI fallback.
//!
//! Moved out of `lib.rs` unchanged (P-H1 step A6). `lib.rs` re-exports
//! [`REMOTE_CSP`] and [`REMOTE_ASSETS_DIR_ENV`] at the crate root, so every existing
//! `warshad::…` path still resolves; the rest of the module is crate-private.

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderValue,
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::warn;
use warsha_remote::rate_limit::rate_key;

use crate::{
    bearer_token, events_handler, retry_after_header, subprotocol_token, DaemonConfig, DaemonError,
    DaemonState, HealthResponse, Result, EVENTS_PATH,
};

/// HTTP server for REST API and WebSocket
async fn health_handler(State(state): State<Arc<DaemonState>>) -> impl IntoResponse {
    let capabilities = state.probe_capabilities().await;
    let status = if capabilities.daemon {
        "healthy".to_string()
    } else {
        "degraded".to_string()
    };
    Json(HealthResponse {
        status,
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: 0,
        capabilities,
    })
}

/// The address both listeners bind, as resolved from the configuration.
///
/// An IP literal and nothing else. A hostname would be resolved once at start and could
/// mean another machine after a DHCP or DNS change, while the startup log and every
/// pairing link quote the address the socket *really* opened — so the owner spells an
/// address, and the daemon never resolves one behind their back. A value that does not
/// parse is a configuration error the owner sees at startup rather than a listener that
/// quietly came up somewhere else.
pub(crate) fn resolve_bind_host(config: &DaemonConfig) -> Result<IpAddr> {
    config.bind_host.trim().parse::<IpAddr>().map_err(|error| {
        DaemonError::Config(format!(
            "`{}` is not an address this daemon can bind: {error}; `bind_host` takes an IP literal \
             such as `127.0.0.1`, and loopback is the default when the configuration names none",
            config.bind_host
        ))
    })
}

/// Whether an address names "every interface" rather than one of them.
fn is_wildcard(addr: IpAddr) -> bool {
    addr.is_unspecified()
}

/// Whether `advertised_host` names a host a pairing link may carry, in its URL spelling.
///
/// Accepted: an IP literal of either version (an IPv6 one comes back bracketed, so the
/// port separator stays unambiguous) and a plain hostname. Refused: anything carrying a
/// URL separator or a space — a scheme, a path, a query, credentials — because the daemon
/// serves plain HTTP and terminates no TLS, so a `https://` in this field would advertise
/// an endpoint it does not have, and a host with a path in it is a link to somewhere else.
fn advertised_host_spelling(raw: &str) -> Option<String> {
    let host = raw.trim();
    if host.is_empty() {
        return None;
    }
    if let Ok(addr) = host.parse::<IpAddr>() {
        return Some(match addr {
            IpAddr::V6(_) => format!("[{addr}]"),
            IpAddr::V4(_) => addr.to_string(),
        });
    }
    let hostname_shape = host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if hostname_shape {
        Some(host.to_string())
    } else {
        None
    }
}

/// The origin `devices.pair-start` puts in a pairing link for a daemon listening on
/// `bind` at the port it actually got, `port`.
///
/// Three cases, and the rule they share is that a link must never advertise an address
/// the daemon is not reachable at:
///
///   * a **loopback** bind advertises that literal. It is honest and it is the default,
///     and it is a link a phone on the same network cannot open — which is what
///     [`warsha_remote::PairingOffer::loopback_only`] says out loud rather than hiding;
///   * a **specific** non-loopback bind (`192.168.1.20`) advertises exactly that address,
///     because the daemon bound only there and the owner named it;
///   * a **wildcard** bind (`0.0.0.0`) is reachable at an address the daemon cannot pick
///     out — enumerating interfaces would be a guess printed on a bearer credential — so
///     it advertises [`DaemonConfig::advertised_host`] when the owner set one, and refuses
///     when they did not. The refusal is actionable and names the flag; the bind itself
///     still serves, because nothing about the listeners depends on this.
pub(crate) fn pairing_origin(
    bind: IpAddr,
    port: u16,
    advertised: Option<&str>,
) -> std::result::Result<String, DaemonError> {
    let host = if is_wildcard(bind) {
        let raw = advertised.ok_or_else(|| {
            DaemonError::Config(format!(
            "this daemon is bound to the wildcard address `{bind}`, so it cannot say which of its \
             addresses a phone should dial; set `advertised_host` in the configuration (or pass \
             `--advertised-host`) to the address the phone reaches this machine at, such as \
             `192.168.1.20`"
        ))
        })?;
        advertised_host_spelling(raw).ok_or_else(|| {
            DaemonError::Config(format!(
            "`{raw}` is not a host a pairing link can advertise: `advertised_host` takes a bare \
             hostname or IP (`warsha.local`, `192.168.1.20`, `fd00::2`) and never a scheme, a path \
             or a port, because the daemon serves plain HTTP on the port it bound"
        ))
        })?
    } else if bind.is_ipv6() {
        format!("[{bind}]")
    } else {
        bind.to_string()
    };
    Ok(format!("http://{host}:{port}"))
}

/// Whether a pairing origin is reachable only from this machine.
///
/// Read off the origin the daemon built, so it is the same fact the listeners act on
/// rather than a second opinion about the configuration. The host is what decides it: a
/// bracketed IPv6 literal (`http://[::1]:8766/`), a plain one, or a hostname from
/// `advertised_host` — which is by definition not a loopback address the daemon invented,
/// and reads as "not loopback" exactly as it should.
///
/// This is the flag that keeps parts A and B honest with each other: a link minted over a
/// loopback bind is a link no phone can open, and the screen has to say so instead of
/// printing a plate that cannot work.
pub(crate) fn origin_is_loopback(origin: &str) -> bool {
    let after_scheme = origin.split("://").nth(1).unwrap_or(origin);
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    let host = authority.rsplit('@').next().unwrap_or_default();
    let host = match host.strip_prefix('[') {
        Some(bracketed) => bracketed.split(']').next().unwrap_or_default(),
        None => host.split(':').next().unwrap_or_default(),
    };
    host.parse::<IpAddr>().is_ok_and(|addr| addr.is_loopback())
}

/// The canonical Content-Security-Policy: the one string the daemon's HTTP routes and its
/// static bundle answer with, and the one `apps/remote/index.html` declares in its
/// `<meta http-equiv="Content-Security-Policy">`.
///
/// Three surfaces carry this policy and they are held to it as one rule set:
/// this daemon (the header, [`REMOTE_CSP`]), the remote bundle (the meta tag) and the
/// desktop webview (`apps/desktop/src-tauri/tauri.conf.json`, whose JSON-embedded copy
/// differs only in the sources Tauri adds — `ipc:` and the wildcard loopback ports).
/// The parity is not a comment: `scripts/check-wire-contract.mjs` reads all three and
/// fails on a drifted directive, and the in-crate test
/// `the_http_listener_sends_the_canonical_csp_and_framing_headers` asserts this exact
/// string on a real response. `object-src 'none'` and `base-uri 'self'` are last so the
/// remote meta can be the same bytes; without them both directives fall back to
/// `default-src 'self'`, which would let same-origin plugin content and a same-origin
/// `<base>` override stand.
///
/// `script-src` names `'self'` and nothing else. It carried `data:` and `blob:` until R-KEEL
/// checkpoint row 15 measured what that admits: a document able to mint a `blob:`/`data:`
/// URL could run script from it, which is the inline hole the absent `'unsafe-inline'` was
/// meant to keep shut. Nothing in the bundle loads script or a worker through either scheme
/// — the one worker registered is `/sw.js`, a same-origin URL, and a worker's script is
/// bounded by `worker-src` falling back to `script-src`, so `script-src 'self'` covers it. The
/// schemes stay in `img-src` (the pairing QR is a `data:image/png`, an artifact export is a
/// `blob:`) and in `style-src`, where they are governed by those directives and not by this
/// one.
pub const REMOTE_CSP: &str = "default-src 'self' data: blob:; script-src 'self'; style-src 'self' data: blob: 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:8765 ws://127.0.0.1:8766 http://localhost:8765 ws://localhost:8766; frame-ancestors 'none'; form-action 'self'; object-src 'none'; base-uri 'self';";

/// The daemon's HTTP surface, assembled once so the listener and the test that asserts
/// its headers drive the same app.
///
/// In layer order, outermost first: CORS (a browser preflight carries no `Authorization`
/// header, so it has to be answered before the auth layer refuses it), the auth/ceiling
/// layer (a bounded answer for every route, a verified caller for every route but
/// `/health`), and the CSP/framing headers, applied closest to the routes so every answer
/// the handlers and the static fallback produce carries [`REMOTE_CSP`]. A refusal the auth
/// layer writes itself (its 401 and its 429) is the one answer that does not pass through
/// them — it is JSON, and it is the documented order rather than an oversight.
pub(crate) fn http_app(state: Arc<DaemonState>) -> Router {
    // The same origin list as the RPC server, from the configuration the state carries.
    let cors = CorsLayer::new()
        .allow_origin(
            state
                .config
                .allowed_origins
                .iter()
                .filter_map(|origin| origin.parse::<axum::http::HeaderValue>().ok())
                .collect::<Vec<axum::http::HeaderValue>>(),
        )
        .allow_methods(Any)
        .allow_headers(Any);

    // CSP middleware: [`REMOTE_CSP`] is the policy, byte for byte the one
    // `apps/remote/index.html` declares in its `<meta http-equiv="Content-Security-Policy">`,
    // so a bundle served from here with or without that tag is held to one rule set, and
    // `apps/desktop/src-tauri/tauri.conf.json` carries the same directives for the
    // webview. The rule set is canonical in one place on purpose: it was documented as
    // "the same" while the daemon and the meta were missing `object-src 'none'` and
    // `base-uri 'self'` (R-KEEL checkpoint rows 8 and 9), and a comment is not a check —
    // `scripts/check-wire-contract.mjs` now reads all three surfaces and refuses a
    // drifted directive. The fonts are the ones bundled by `@warsha/ui/v3/fonts.css`
    // (`@fontsource/ibm-plex-sans-arabic` and `@fontsource/ibm-plex-mono`, owner
    // decision OD-U2 = A), so `font-src 'self'` is all they need. `style-src` keeps
    // 'unsafe-inline' because Vite's dev server injects `<style>` tags for HMR; the
    // built bundle's React `style` props are CSSOM writes, which CSP does not govern.
    // `connect-src` keeps the loopback pairs for a bundle served elsewhere (Vite dev,
    // the desktop) and `'self'` covers the daemon's own origin, including the `ws:`
    // upgrade of it.
    let csp_middleware = tower::ServiceBuilder::new().map_response(|mut response: Response| {
        if let Ok(header_value) = HeaderValue::from_str(REMOTE_CSP) {
            response
                .headers_mut()
                .insert("Content-Security-Policy", header_value);
        }
        // The policy above is the only script source; stop the webview from
        // second-guessing a response's content type.
        if let Ok(header_value) = HeaderValue::from_str("nosniff") {
            response
                .headers_mut()
                .insert("X-Content-Type-Options", header_value);
        }
        // `frame-ancestors` is ignored in a meta tag, so this is the half of the
        // framing rule a document cannot state for itself.
        if let Ok(header_value) = HeaderValue::from_str("DENY") {
            response
                .headers_mut()
                .insert("X-Frame-Options", header_value);
        }
        response
    });

    // Auth middleware: a bounded ceiling on every route, and a verified bearer token
    // on every route except /health (security audit H-01, H-03, H-04).
    let auth_middleware = axum::middleware::from_fn_with_state(state.clone(), auth_handler_inner);

    // `/health` and `/events` are real routes, so they match before any fallback and
    // keep their existing handlers whatever the static surface does; `/rpc` lives on
    // the other listener and is refused from the static path by name
    // ([`is_reserved_static_path`]). The fallback is mounted only when a bundle is
    // configured: with none, an unmatched path 404s exactly as it did before.
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/events", get(events_handler));
    let app = if state.config.remote_assets_dir.is_some() {
        app.fallback(static_asset_handler)
    } else {
        app
    };
    app.layer(csp_middleware)
        .layer(auth_middleware)
        .layer(cors)
        .with_state(state)
}

/// The HTTP listener's ceiling and authentication: a bounded answer for every route,
/// and a verified caller for every route but `/health`.
///
/// Three things the audit asked for happen here (H-01, H-03, H-04):
///
/// - **A 429 with a `Retry-After`.** The listener used to have no overload path at
///   all: `/events` would take as many sockets as a caller could open.
/// - **A ceiling keyed on who is calling.** This listener knows the peer address (the
///   RPC transport's middleware does not), so an authenticated identity decides the
///   bucket and the address is the fallback for a caller that never got authenticated.
/// - **The verified caller, in the request.** A handler that wants to know who asked
///   reads the [`Actor`] the credential produced — never a field of its own params.
///
/// The credential is a bearer header on every route, and additionally a
/// `warsha.token.<token>` subprotocol on `/events` — the only form a browser can send on
/// a WebSocket handshake, and the reason that socket was being refused (task #49). Both
/// forms go to the same [`Sessions::resolve`] and are refused the same way. Neither is a
/// URL query parameter, which this listener never reads.
async fn auth_handler_inner(
    State(state): State<Arc<DaemonState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    mut request: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path();
    // The credential, in the order the two forms are trusted. A bearer header is what
    // every HTTP caller sends and what every other route answers to; the subprotocol
    // form exists only because a browser cannot set a header on a WebSocket handshake,
    // and it is read on `/events` and nowhere else. A token in the URL is never read at
    // all — see [`subprotocol_token`].
    let token = bearer_token(&headers);
    let token = if token.is_empty() && path == EVENTS_PATH {
        subprotocol_token(&headers)
    } else {
        token
    };

    if path == "/health" {
        // The one route that answers without a credential is still bounded, per peer:
        // an unauthenticated free path is a limiter an attacker routes around.
        let ceiling = state.rates.transport().check(&rate_key(None, Some(peer)));
        if !ceiling.is_allowed() {
            return http_refusal(
                axum::http::StatusCode::TOO_MANY_REQUESTS,
                serde_json::json!({ "error": "rate limited" }),
                Some(ceiling.retry_after_secs()),
            );
        }
        return next.run(request).await;
    }

    let actor = state
        .sessions
        .resolve(&token, &state.active_pairings().await);
    let key = rate_key(actor.as_ref().map(|actor| actor.key()), Some(peer));

    let ceiling = state.rates.transport().check(&key);
    if !ceiling.is_allowed() {
        state.report_refusal("http-transport", &key);
        return http_refusal(
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            serde_json::json!({ "error": "rate limited" }),
            Some(ceiling.retry_after_secs()),
        );
    }

    let Some(actor) = actor else {
        // `/events` is the only authenticated surface on this listener. Everything
        // else it can answer without a session is the static remote UI (a built SPA's
        // `index.html`, its hashed assets, its client routes) or a 404 — neither is a
        // secret, and a browser loading a remote page cannot attach a bearer header
        // to the `<script>`/`<link>`/history-route requests it makes. The ceiling
        // above still bounds every caller per peer. With no bundle configured this
        // pass-through reaches a router that 404s the path, exactly as before; an
        // unauthenticated `/events` is still refused, and the RPC surface on the
        // other port authenticates in its own transport and is unaffected.
        if path != EVENTS_PATH {
            return next.run(request).await;
        }
        warn!("Unauthorized request to {path}");
        return http_refusal(
            axum::http::StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "unauthorized" }),
            None,
        );
    };

    request.extensions_mut().insert(actor);
    next.run(request).await
}

/// A refusal on the daemon's HTTP listener, with the wait a rate-limited caller must
/// honour before trying again.
fn http_refusal(
    status: axum::http::StatusCode,
    body: serde_json::Value,
    retry_after_secs: Option<u64>,
) -> Response {
    let mut builder = axum::http::Response::builder().status(status);
    if let Some(secs) = retry_after_secs {
        builder = builder.header(axum::http::header::RETRY_AFTER, retry_after_header(secs));
    }
    builder
        .header(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("application/json"),
        )
        .body(axum::body::Body::from(body.to_string()))
        .unwrap_or_else(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                body.to_string(),
            )
                .into_response()
        })
}

// ============================================================ static remote UI

/// The environment variable that opts the daemon's HTTP listener into serving a
/// pre-built remote UI bundle from disk (see [`DaemonConfig::remote_assets_dir`]).
pub const REMOTE_ASSETS_DIR_ENV: &str = "WARSHA_REMOTE_ASSETS_DIR";

/// Paths static serving must never answer, even through the fallback. `/events` and
/// `/health` are matched routes that win over the fallback at the router, and their
/// *prefixed* children are refused here so a stray `/health/notes` or `/events/x`
/// cannot render the SPA shell instead of the daemon's own answer; `/rpc` belongs to
/// the RPC listener on [`DaemonConfig::ws_port`], and a request that reached this
/// port for it gets a refusal, not an HTML page that would hide the misroute.
fn is_reserved_static_path(path: &str) -> bool {
    path == EVENTS_PATH
        || path.starts_with("/events/")
        || path == "/health"
        || path.starts_with("/health/")
        || path == "/rpc"
        || path.starts_with("/rpc/")
}

/// The fallback handler of the HTTP listener when a remote UI bundle is configured.
///
/// What it serves, in priority order: a real file under the bundle directory; an
/// `index.html` inside a matched directory; the SPA history fallback for an
/// extension-less client route (`/runs/<id>` and friends); otherwise 404. Anything
/// that tries to leave the bundle directory — a `..` in any spelling, percent-encoded
/// included, or the Windows separators — is a 400 rather than a read attempt, and a
/// reserved daemon path is a 404 rather than a page. The bundle is public UI: no
/// response here carries a credential, and the rate ceiling in
/// [`auth_handler_inner`] bounds the caller per peer exactly as it bounds every
/// other route.
async fn static_asset_handler(
    State(state): State<Arc<DaemonState>>,
    request: axum::http::Request<axum::body::Body>,
) -> Response {
    let Some(assets_dir) = state.config.remote_assets_dir.clone() else {
        return static_not_found();
    };
    if !matches!(request.method().as_str(), "GET" | "HEAD") {
        return static_not_found();
    }
    let path = request.uri().path();
    if is_reserved_static_path(path) {
        return static_not_found();
    }

    // Decode *before* splitting: a traversal arrives as `/%2e%2e/etc/passwd` exactly
    // as it arrives as `/../etc/passwd`, and the second form is what a naive proxy
    // forwards. Every segment is then checked for the shapes that mean "outside" —
    // the dot-dot, the backslash and colon spellings of a Windows escape (a bare
    // drive letter is the colon case), and control characters no served file is
    // named with.
    let decoded = percent_decode_path(path);
    let mut segments: Vec<&str> = Vec::new();
    for segment in decoded.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".."
            || segment.contains('\\')
            || segment.contains(':')
            || segment.chars().any(|c| (c as u32) < 0x20)
        {
            return static_bad_request();
        }
        segments.push(segment);
    }

    // The bundle root as the operating system sees it, so the containment check
    // below compares resolved paths and a symlink into `/etc` cannot pass it. A root
    // that does not exist serves nothing; that is a 404, not a broken daemon.
    let Ok(root) = tokio::fs::canonicalize(&assets_dir).await else {
        return static_not_found();
    };
    let mut candidate = root.clone();
    for segment in &segments {
        candidate.push(segment);
    }
    if !candidate.starts_with(&root) {
        return static_bad_request();
    }

    if let Ok(canonical_candidate) = tokio::fs::canonicalize(&candidate).await {
        if !canonical_candidate.starts_with(&root) {
            return static_bad_request();
        }
        if let Ok(meta) = tokio::fs::metadata(&canonical_candidate).await {
            if meta.is_file() {
                return serve_static_file(&canonical_candidate, path).await;
            }
        }
    }

    // A directory gets its own index.html when it has one; a missing path
    // falls through to the SPA rule.
    let dir_index = candidate.join("index.html");
    if let Ok(canonical_dir_index) = tokio::fs::canonicalize(&dir_index).await {
        if !canonical_dir_index.starts_with(&root) {
            return static_bad_request();
        }
        if let Ok(meta) = tokio::fs::metadata(&canonical_dir_index).await {
            if meta.is_file() {
                return serve_static_file(&canonical_dir_index, path).await;
            }
        }
    }

    // History fallback: a client route's last segment carries no extension.
    // A path that *looks* like a file (`/missing-hash.js`) is a plain 404, so
    // a stale bundle reference never masquerades as the app shell.
    if segments.last().is_some_and(|last| last.contains('.')) {
        return static_not_found();
    }
    let spa_index = root.join("index.html");
    if let Ok(canonical_spa_index) = tokio::fs::canonicalize(&spa_index).await {
        if canonical_spa_index.starts_with(&root) {
            if let Ok(meta) = tokio::fs::metadata(&canonical_spa_index).await {
                if meta.is_file() {
                    return serve_static_file(&canonical_spa_index, path).await;
                }
            }
        }
    }
    static_not_found()
}

/// One bundle file onto the wire, with the type and caching its name decides.
async fn serve_static_file(full: &Path, request_path: &str) -> Response {
    let Ok(bytes) = tokio::fs::read(full).await else {
        return static_not_found();
    };
    let response = axum::http::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static(static_content_type(full)),
        )
        .header(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static(static_cache_control(request_path, full)),
        )
        .body(axum::body::Body::from(bytes));
    response.unwrap_or_else(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "could not build the static response",
        )
            .into_response()
    })
}

fn static_not_found() -> Response {
    http_refusal(
        axum::http::StatusCode::NOT_FOUND,
        serde_json::json!({ "error": "not found" }),
        None,
    )
}

fn static_bad_request() -> Response {
    http_refusal(
        axum::http::StatusCode::BAD_REQUEST,
        serde_json::json!({ "error": "invalid path" }),
        None,
    )
}

/// Percent-decode a URI path. A malformed escape (`%zz`, a truncated `%a`) is kept
/// verbatim rather than refused: it cannot form a path segment this handler serves,
/// and passing it through keeps the segment checks the single place refusals happen.
fn percent_decode_path(input: &str) -> String {
    fn hex_value(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = hex_value(bytes[index + 1]);
            let low = hex_value(bytes[index + 2]);
            if let (Some(high), Some(low)) = (high, low) {
                out.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The `Content-Type` a bundle file is served with, by extension. The set is the one
/// a built SPA ships; anything else is opaque bytes, never guessed HTML, so a bundle
/// file with an unknown name cannot become an active document on the daemon's origin.
fn static_content_type(full: &Path) -> &'static str {
    let extension = full
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") | Some("cjs") => "application/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("map") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("txt") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml",
        Some("wasm") => "application/wasm",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        _ => "application/octet-stream",
    }
}

/// The `Cache-Control` a bundle file is served with.
///
/// `index.html` — directly, as `/`, or as the history fallback — is `no-cache`: it is
/// the one file whose content a redeploy changes without changing its name, and a
/// stale shell is a black screen (the remote UI's P0). A hashed asset — under the
/// bundle's `/assets/` prefix or carrying a content hash in its name — is immutable
/// for a year, which is what its name is *for*: the same URL never means different
/// bytes. Everything else is `no-cache` too; serving a misnamed live file from a CDN
/// cache is the failure this table exists to prevent.
fn static_cache_control(request_path: &str, full: &Path) -> &'static str {
    let file_name = full.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if file_name.eq_ignore_ascii_case("index.html") {
        return "no-cache";
    }
    let under_assets = percent_decode_path(request_path).starts_with("/assets/");
    if under_assets || looks_hashed_file_name(file_name) {
        return "public, max-age=31536000, immutable";
    }
    "no-cache"
}

/// Whether a bundle file name carries a content hash after its last hyphen — the
/// `app-1234abcd.js`, `index-D2hP1rSv9Q.js` shape every modern bundler emits. The
/// tail must be at least eight alphanumeric characters and contain a digit, so
/// `vendor-polyfill.js` and `-legacy` suffixes stay cache-revalidating.
fn looks_hashed_file_name(file_name: &str) -> bool {
    let stem = file_name
        .rsplit_once('.')
        .map_or(file_name, |(stem, _extension)| stem);
    stem.rsplit_once('-')
        .map(|(_prefix, hash)| {
            hash.len() >= 8
                && hash.chars().all(|c| c.is_ascii_alphanumeric())
                && hash.chars().any(|c| c.is_ascii_digit())
        })
        .unwrap_or(false)
}
