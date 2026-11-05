//! warsha-desktop — the Tauri 2 shell around the `warshad` daemon.
//!
//! The window is a webview running `apps/desktop/src`, and that frontend talks to the daemon
//! over loopback HTTP (`POST <base_url>/rpc`) and its `/events` socket. It therefore needs two
//! things the browser build cannot discover: the port the daemon actually bound, and the bearer
//! token it expects. Both travel to the webview through `get_config` — `daemon_url`,
//! `daemon_ws_url` and `daemon_token` — which is the same Tauri command the frontend already
//! uses for `onboarding_complete` and `app_mode`, so no new channel, permission or event had to
//! be invented for it.
//!
//! The daemon runs *in this process*: `warshad::start_daemon` is the library entry point the
//! `warshad` binary itself calls, so the shell gets the bound ports back directly and can shut
//! the daemon down on exit. The reasoning, and why a sidecar was not used, is in `DECISIONS.md`.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Manager, RunEvent, State};
use warshad::{DaemonConfig, DaemonError, DaemonHandle};

/// Config key reporting the daemon's JSON-RPC base URL, e.g. `http://127.0.0.1:8766`.
pub const CONFIG_DAEMON_URL: &str = "daemon_url";

/// Config key reporting the daemon's `/events` endpoint, e.g. `ws://127.0.0.1:8765`.
pub const CONFIG_DAEMON_WS_URL: &str = "daemon_ws_url";

/// Config key reporting the bearer token the daemon expects on every request.
pub const CONFIG_DAEMON_TOKEN: &str = "daemon_token";

/// The three keys above are the shell's to answer: `set_config` refuses them, so a stray write
/// from the webview cannot point the app at an endpoint that is not there.
const SHELL_OWNED_KEYS: [&str; 3] = [CONFIG_DAEMON_URL, CONFIG_DAEMON_WS_URL, CONFIG_DAEMON_TOKEN];

/// Name of the settings file the non-daemon preferences live in, inside the daemon's data dir.
///
/// `onboarding_complete` and `app_mode` are the two keys the frontend writes today; keeping them
/// beside the daemon's own state means one directory to back up, delete or inspect for the whole
/// app.
const SETTINGS_FILE: &str = "desktop.json";

/// Name of the plain-text log this shell appends start-up failures to.
///
/// A release Windows build has no console (`windows_subsystem = "windows"` in `main.rs`), so an
/// `eprintln!` on a machine whose daemon refuses to start would be invisible; the installer
/// documentation points at this file instead.
const LOG_FILE: &str = "desktop.log";

/// Where the daemon is, and the token that reaches it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DaemonEndpoint {
    /// JSON-RPC base URL — the frontend's `createClient` argument.
    pub base_url: String,
    /// The `/events` WebSocket endpoint.
    pub ws_url: String,
    /// Bearer token the daemon was started with.
    pub token: String,
    /// `true` when this shell started the daemon and therefore stops it on exit. A second launch
    /// of the app (or a daemon someone started with `warshad`) reports `false`: it uses that
    /// daemon and leaves it running.
    pub owned: bool,
}

/// The shell's live state: the daemon it owns, where it is, and the webview's own preferences.
pub struct ShellState {
    endpoint: DaemonEndpoint,
    /// The daemon this shell started, kept so `RunEvent::Exit` can stop it.
    process: Mutex<Option<DaemonHandle>>,
    settings: Mutex<BTreeMap<String, String>>,
    settings_path: PathBuf,
    log_path: PathBuf,
}

impl ShellState {
    /// The webview's preferences, with a poisoned lock read as the map it holds.
    ///
    /// A `Mutex` is poisoned when its holder panicked, and the map behind it is a plain
    /// `BTreeMap` that did not participate: answering "no settings" (on a read) or
    /// "cannot save" (on a write) would throw away the owner's mode and theme because of
    /// a panic somewhere else in the shell. This is the same reading
    /// `InMemorySecretStore` applies to its own map.
    fn preferences(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, String>> {
        match self.settings.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// The value `get_config` answers for `key`.
    ///
    /// The three daemon keys are answered from the endpoint the shell started, never from the
    /// file: a stale `desktop.json` must not be able to redirect the frontend. Every other key is
    /// the webview's own, and an unknown key is the empty string — which is what the frontend's
    /// `checkOnboarding` already expects for "not set yet".
    fn get(&self, key: &str) -> String {
        match key {
            CONFIG_DAEMON_URL => self.endpoint.base_url.clone(),
            CONFIG_DAEMON_WS_URL => self.endpoint.ws_url.clone(),
            CONFIG_DAEMON_TOKEN => self.endpoint.token.clone(),
            _ => self.preferences().get(key).cloned().unwrap_or_default(),
        }
    }

    /// Persist `key = value` for the webview's own keys.
    ///
    /// Three things a stored preference owes its owner, only one of which the first
    /// version of this shell did:
    ///
    /// - **the write is atomic** (see [`write_settings`]), because an app killed mid-write left
    ///   a file that does not parse, and [`read_settings`] answers that with an empty map — so
    ///   the owner's mode and theme would come back as "never set" after the crash that lost
    ///   them;
    /// - **it does not lose what it did not write**: the file is read again and merged, so a key
    ///   the owner set from another window of the same install survives;
    /// - **a failure is said**, in the error string the webview shows and in `desktop.log`.
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        if SHELL_OWNED_KEYS.contains(&key) {
            return Err(format!("{key} is reported by the shell and cannot be set"));
        }
        if key.trim().is_empty() {
            return Err("a setting needs a name".to_string());
        }
        let snapshot = {
            let mut settings = self.preferences();
            settings.insert(key.to_string(), value.to_string());
            settings.clone()
        };
        let mut merged = read_settings(&self.settings_path);
        // This process's map wins on the keys it holds: it is the state the owner is looking
        // at, and it is the write that was just asked for.
        for (name, value) in snapshot {
            merged.insert(name, value);
        }
        write_settings(&self.settings_path, &merged).map_err(|error| {
            self.note(&format!("could not store {key}: {error}"));
            error
        })
    }

    /// Append one line to the shell's log, best effort: a log that cannot be written must not be
    /// the reason the app fails to start.
    fn note(&self, message: &str) {
        append_note(&self.log_path, message);
    }
}

/// Append one stamped line to a log file, creating it and its directory when they are not there.
///
/// Shared by [`ShellState::note`] and [`daemon_for`], because the one message an owner needs
/// about a daemon that refused to start is written before there is a shell state to write it
/// with.
fn append_note(path: &Path, message: &str) {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "[{stamp}] {message}");
    }
}

/// Read the shell's settings file; a missing or unreadable file is simply an empty map.
///
/// An empty map rather than an error is the frontend's contract: `checkOnboarding` reads
/// `onboarding_complete` before the owner has ever set it, and a first launch must not fail
/// because nothing was stored yet. What that means for durability is the other half — an
/// unreadable file reads as "nothing was ever set" — which is exactly why [`write_settings`]
/// is atomic.
fn read_settings(path: &Path) -> BTreeMap<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// The counter that makes each settings write's scratch file unique.
static SETTINGS_WRITE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Write the shell's settings file, creating its directory if it is not there yet.
///
/// A temp file and a rename, not `fs::write` over the live file: a rename replaces the
/// target atomically, while a write that is interrupted by a crash, a power loss or a
/// killed process leaves the file half-written — and a half-written JSON file reads back
/// as an empty map, which is an owner who lost their mode, their theme and their
/// onboarding answer without a word about it.
fn write_settings(path: &Path, settings: &BTreeMap<String, String>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{path:?} has no directory"))?;
    std::fs::create_dir_all(parent).map_err(|error| format!("{parent:?}: {error}"))?;
    let json = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;

    let sequence = SETTINGS_WRITE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let scratch = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "settings".to_string()),
        std::process::id(),
        sequence
    ));
    std::fs::write(&scratch, json.as_bytes()).map_err(|error| format!("{scratch:?}: {error}"))?;
    std::fs::rename(&scratch, path).map_err(|error| {
        // The live file is untouched either way; the scratch file is nothing the next
        // write should inherit.
        let _ = std::fs::remove_file(&scratch);
        format!("{path:?}: {error}")
    })
}

/// The origins the daemon has to accept the webview's requests from.
///
/// The webview is not served from `http://127.0.0.1:<port>`, so every `fetch` it makes to the
/// daemon is cross-origin and the daemon has to name it. Windows serves the app from
/// `http://tauri.localhost` (Tauri 2's webview origin), macOS and Linux from `tauri://localhost`,
/// and `http://localhost:5173` is `pnpm tauri dev`'s Vite server.
fn webview_origins() -> Vec<String> {
    [
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        "http://localhost:5173",
    ]
    .iter()
    .map(|origin| (*origin).to_string())
    .collect()
}

/// A copy of `config` with the webview's origins added to whatever it already allowed.
fn with_webview_origins(mut config: DaemonConfig) -> DaemonConfig {
    for origin in webview_origins() {
        if !config.allowed_origins.contains(&origin) {
            config.allowed_origins.push(origin);
        }
    }
    config
}

/// The endpoint of a daemon that is already running on the ports `config` names.
fn configured_endpoint(config: &DaemonConfig) -> DaemonEndpoint {
    DaemonEndpoint {
        base_url: format!("http://127.0.0.1:{}", config.ws_port),
        ws_url: format!("ws://127.0.0.1:{}", config.http_port),
        token: config.auth_token.clone(),
        owned: false,
    }
}

/// Start the daemon this shell owns, or describe the one that is already there.
///
/// Three outcomes, in order of preference:
///
/// 1. the daemon starts and the shell owns it (the normal first launch);
/// 2. it refuses because another instance holds the data directory's lock, in which case that
///    instance's daemon *is* reachable — both read the same `config.toml`, so the token and the
///    ports agree, and the shell simply does not own what it did not start;
/// 3. it refuses for any other reason (a port taken by an unrelated program is the realistic
///    one), and the shell retries once with OS-chosen ports, which cannot collide.
///
/// The data directory comes back with the outcome either way, because the shell's own settings
/// and log file live in it. Nothing is started when the configuration cannot be read at all: a
/// daemon without that file would have to invent a token, and an invented token is one the
/// frontend cannot be told.
fn start_shell() -> (
    PathBuf,
    Result<(DaemonEndpoint, Option<DaemonHandle>), String>,
) {
    let config = match tauri::async_runtime::block_on(warshad::load_or_create_config(None)) {
        Ok(config) => config,
        Err(error) => {
            let fallback = std::env::temp_dir().join("warsha");
            return (
                fallback,
                Err(format!("could not read the daemon configuration: {error}")),
            );
        }
    };
    let data_dir = config.data_dir.clone();

    (data_dir, daemon_for(config))
}

/// Start the daemon `config` describes, or describe the one already running on its ports.
fn daemon_for(config: DaemonConfig) -> Result<(DaemonEndpoint, Option<DaemonHandle>), String> {
    let config = with_webview_origins(config);
    let log_path = config.data_dir.join(LOG_FILE);
    match tauri::async_runtime::block_on(warshad::start_daemon(config.clone())) {
        Ok(handle) => Ok((
            DaemonEndpoint {
                base_url: format!("http://127.0.0.1:{}", handle.rpc_port()),
                ws_url: format!("ws://127.0.0.1:{}", handle.http_port()),
                token: config.auth_token.clone(),
                owned: true,
            },
            Some(handle),
        )),
        Err(DaemonError::Lock(reason)) => {
            // The daemon's own words name the process holding the data directory. They go in the
            // log the installer documentation points at, because this is the one start outcome an
            // owner has no way to see from the window: the app looks normal, and a stray
            // `warshad` from an earlier crash is what is answering it.
            append_note(
                &log_path,
                &format!("using a daemon another instance already started: {reason}"),
            );
            Ok((configured_endpoint(&config), None))
        }
        Err(first_failure) => {
            let mut free_ports = config.clone();
            free_ports.http_port = 0;
            free_ports.ws_port = 0;
            match tauri::async_runtime::block_on(warshad::start_daemon(free_ports)) {
                Ok(handle) => Ok((
                    DaemonEndpoint {
                        base_url: format!("http://127.0.0.1:{}", handle.rpc_port()),
                        ws_url: format!("ws://127.0.0.1:{}", handle.http_port()),
                        token: config.auth_token.clone(),
                        owned: true,
                    },
                    Some(handle),
                )),
                Err(second_failure) => Err(format!(
                    "warshad did not start: {first_failure}; retrying on OS-chosen ports: {second_failure}"
                )),
            }
        }
    }
}

/// Send one hand-written HTTP/1.1 request to `addr` and return the whole response as text.
///
/// Hand-written because the shell needs exactly three requests — an authorized JSON-RPC POST, an
/// unauthorized one, and a CORS preflight — and a full HTTP client would be a dependency this
/// crate does not otherwise use. `Connection: close` makes the daemon close the socket after its
/// answer, so reading to end-of-stream is the whole response.
fn raw_request(addr: &str, request: &str) -> Result<String, String> {
    use std::io::{Read, Write};

    let mut stream =
        std::net::TcpStream::connect(addr).map_err(|error| format!("connect {addr}: {error}"))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("write to {addr}: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("read from {addr}: {error}"))?;
    Ok(response)
}

/// The JSON-RPC POST `warsha-client` sends: `POST <base>/rpc`, bearer token, JSON body.
fn rpc_request(host: &str, token: &str, method: &str) -> String {
    let body = format!(r#"{{"jsonrpc":"2.0","id":1,"method":"{method}"}}"#);
    format!(
        "POST /rpc HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nAuthorization: Bearer {token}\r\n\r\n{body}",
        body.len()
    )
}

/// The preflight a browser sends before that POST, from the webview's own origin.
fn preflight_request(host: &str, origin: &str) -> String {
    format!(
        "OPTIONS /rpc HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: authorization,content-type\r\nConnection: close\r\n\r\n"
    )
}

/// A JSON-RPC POST with a caller-supplied `params` value.
///
/// `warsha-client` sends its params as a named map, and the daemon binds both the snake_case
/// and the camelCase spelling (`crates/warshad/tests/gates_list.rs` proves it), so the smoke
/// calls below use exactly the shapes that client uses rather than inventing a third.
fn rpc_post_request(host: &str, token: &str, method: &str, params: serde_json::Value) -> String {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    })
    .to_string();
    format!(
        "POST /rpc HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nAuthorization: Bearer {token}\r\n\r\n{body}",
        body.len()
    )
}

/// The `result` of a JSON-RPC answer, or `None` when the response is not a 200 with a result.
///
/// The smoke calls need three things from one response — the status line says 200, there is no
/// `error` object, and the `result` is there to read ids and artifact names out of — and they
/// need them from the *whole* response, headers included, so the body is separated here once.
fn rpc_json_body(response: &str) -> Option<serde_json::Value> {
    let (headers, body) = response.split_once("\r\n\r\n")?;
    if !headers.contains("200") {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    if value.get("error").is_some() {
        return None;
    }
    value.get("result").cloned()
}

/// The daemon's `result` from a [`raw_request`] outcome: `None` unless the socket round trip
/// succeeded *and* the answer is a 200 with a JSON-RPC result.
fn rpc_result(outcome: &Result<String, String>) -> Option<serde_json::Value> {
    outcome.as_deref().ok().and_then(rpc_json_body)
}

/// The one-line detail for a failed smoke call: the status line when the daemon answered,
/// the connect/write error when it did not.
fn response_detail(outcome: &Result<String, String>) -> String {
    match outcome {
        Ok(response) => first_line(response),
        Err(error) => error.clone(),
    }
}

/// The first `key` found as a string anywhere in a JSON-RPC `result`, depth first.
///
/// The smoke run needs two ids out of two different replies — the project's from
/// `projects.create` and the run's from `runs.start` — and neither call site should have to
/// restate the daemon's exact field layout for the second time; the field names those replies
/// use (`id`) are the same in both, and a wrong shape reads as `None`, which the caller reports
/// as a failed check rather than a panic.
fn first_string(value: &serde_json::Value, key: &str) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => map
            .get(key)
            .and_then(|found| found.as_str())
            .map(str::to_string)
            .or_else(|| map.values().find_map(|child| first_string(child, key))),
        serde_json::Value::Array(items) => items.iter().find_map(|item| first_string(item, key)),
        _ => None,
    }
}

/// `GET /health` on the daemon's HTTP port, with no credential.
///
/// `/health` is the one route the daemon answers without a bearer token (the same exemption
/// documented in `crates/warshad/src/lib.rs`), so it is also the one the installer check can
/// aim at the `ws_url` the frontend gets: `ws://` becomes `http://` and the port is the
/// daemon's events port, which is exactly where the window's live feed would connect.
fn health_request(host: &str) -> String {
    format!("GET /health HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n")
}

/// The shape of the `PASS`/`FAIL` recorder [`self_check`] defines for its own run: it takes
/// the run's failure list, the condition being proved, the label to print, and the one-line
/// detail for the failure. Named here because the installer checks receive it as a trait
/// object and clippy is right that the inline type is too dense to repeat.
type CheckFn = dyn for<'a> Fn(&'a mut Vec<String>, bool, &'a str, &'a str);

/// Prove `GET /health` answers 200 with a status field, and record the outcome.
fn check_health(failures: &mut Vec<String>, ws_url: &str) {
    let health_host = ws_url.trim_start_matches("ws://");
    let outcome = raw_request(health_host, &health_request(health_host));
    match &outcome {
        Ok(response) => {
            let answered = response.contains("200")
                && response.contains(r#""status""#)
                && (response.contains("healthy") || response.contains("ok"));
            if answered {
                println!(
                    "PASS  GET /health on the daemon's HTTP port answers 200 with a healthy status"
                );
            } else {
                println!(
                    "FAIL  GET /health on the daemon's HTTP port answers 200 with a healthy status — {}",
                    first_line(response)
                );
                failures.push("GET /health answers 200 with a healthy status".to_string());
            }
        }
        Err(error) => {
            println!("FAIL  GET /health on the daemon's HTTP port answers 200 with a healthy status — {error}");
            failures.push("GET /health answers 200 with a healthy status".to_string());
        }
    }
}

/// The installer smoke test: one complete pipeline run driven over JSON-RPC with **no API
/// key at all**, against a daemon whose data lives in a scratch directory.
///
/// This is the zero-configuration path a fresh install takes its first steps on, proved
/// end-to-end rather than by a unit test in one crate: `projects.create` → `runs.start` →
/// `gates.approve` (Gate A) → `runs.advance` (which walks Idea → GateA → Research → PrdSpec
/// and stops at the pending Gate B) → `runs.artifacts`. The stage calls are answered by the
/// pipeline's deterministic `FakeProvider` (`crates/warsha-pipeline` dispatch case 3), which
/// makes no network call; `WARSHA_LLM_PROVIDER=fake` is set here so a `WARSHA_LLM_API_KEY`
/// inherited from this machine's environment cannot quietly turn the smoke run into a real,
/// paid model call — the same guarantee the repository's rules make for every test.
///
/// The checks this appends are only run when the daemon answered with a result; a refusal at
/// any step stops the walk early, because a `runs.advance` over a run that was never created
/// would prove nothing except that the store says "not found".
fn check_fake_provider_pipeline(
    failures: &mut Vec<String>,
    host: &str,
    token: &str,
    check: &CheckFn,
) {
    std::env::set_var("WARSHA_LLM_PROVIDER", "fake");

    let create = raw_request(
        host,
        &rpc_post_request(
            host,
            token,
            "projects.create",
            serde_json::json!({
                "name": "smoke-project",
                "description": "Installer smoke test",
                "language": "ar"
            }),
        ),
    );
    let project_id = rpc_result(&create).and_then(|result| first_string(&result, "id"));
    check(
        failures,
        project_id.is_some(),
        "projects.create creates the smoke project",
        &response_detail(&create),
    );
    let Some(project_id) = project_id else {
        failures.push("the zero-key FakeProvider run needs a project".to_string());
        return;
    };

    let start = raw_request(
        host,
        &rpc_post_request(
            host,
            token,
            "runs.start",
            serde_json::json!({ "projectId": project_id, "idea": "Build an Arabic task tracker" }),
        ),
    );
    let run_id = rpc_result(&start).and_then(|result| first_string(&result, "id"));
    check(
        failures,
        run_id.is_some(),
        "runs.start starts the smoke run at the Idea stage",
        &response_detail(&start),
    );
    let Some(run_id) = run_id else {
        failures.push("the zero-key FakeProvider run needs a run".to_string());
        return;
    };

    let approve = raw_request(
        host,
        &rpc_post_request(
            host,
            token,
            "gates.approve",
            serde_json::json!({ "run_id": run_id, "stage": "gate_a", "device_id": null }),
        ),
    );
    let approved = rpc_result(&approve).is_some();
    check(
        failures,
        approved,
        "gates.approve records the Gate A decision over RPC",
        &response_detail(&approve),
    );
    if !approved {
        failures.push("the zero-key FakeProvider run needs Gate A approved".to_string());
        return;
    }

    let advance = raw_request(
        host,
        &rpc_post_request(
            host,
            token,
            "runs.advance",
            serde_json::json!({ "run_id": run_id }),
        ),
    );
    let advanced = rpc_result(&advance);
    check(
        failures,
        advanced.is_some(),
        "runs.advance walks Idea → GateA → Research → PrdSpec on the zero-key FakeProvider",
        &response_detail(&advance),
    );
    if let Some(run) = &advanced {
        // `Stage` serializes snake_case on the wire (`serde(rename_all = "snake_case")` in
        // `warsha-core`), and the walk is defined to stop at the first gate with no decision,
        // which after approving Gate A is Gate B.
        check(
            failures,
            run.get("current_stage").and_then(|stage| stage.as_str()) == Some("gate_b"),
            "the smoke run is waiting at Gate B",
            &response_detail(&advance),
        );
    } else {
        failures.push("the zero-key FakeProvider run must reach Gate B".to_string());
        return;
    }

    let artifacts = raw_request(
        host,
        &rpc_post_request(
            host,
            token,
            "runs.artifacts",
            serde_json::json!({ "run_id": run_id }),
        ),
    );
    let names: Vec<String> = rpc_result(&artifacts)
        .and_then(|result| result.as_array().cloned())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name"))
                .filter_map(|name| name.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let produced = ["idea", "research", "prd_spec"]
        .iter()
        .all(|wanted| names.iter().any(|name| name == *wanted));
    if produced {
        println!("PASS  zero-key FakeProvider run produced research and prd_spec artifacts");
    } else {
        println!(
            "FAIL  zero-key FakeProvider run produced research and prd_spec artifacts — the run carries {:?}",
            names
        );
        failures
            .push("zero-key FakeProvider run produced research and prd_spec artifacts".to_string());
    }
}

/// `--self-check [--data-dir <path>]` — start the daemon exactly as the window does, prove the
/// webview could reach it, and stop it again. Returns an error naming every check that failed.
///
/// This exists because the half of this app that needs no window is the half that breaks in
/// silence: a host that cannot create a webview (a headless CI runner, a locked-down session) still
/// has to be able to answer "does `warshad` start, and can the frontend reach it?".
///
/// `--data-dir` points the check at a scratch directory instead of the owner's real one, which is
/// what a CI runner wants: the check must not touch the projects of whoever runs it. It is also
/// the only case that runs [`restart_safety_report`] and the installer checks
/// ([`check_health`] and [`check_fake_provider_pipeline`]), because those start and stop daemons
/// over the directory twice and write a smoke project and a full pipeline run into it, and no
/// check has any business doing that to a live install.
pub fn self_check(scratch: Option<&Path>) -> anyhow::Result<()> {
    let (data_dir, outcome, restart_config) = match scratch {
        None => {
            let (data_dir, outcome) = start_shell();
            (data_dir, outcome, None)
        }
        Some(dir) => {
            let mut config = tauri::async_runtime::block_on(warshad::load_or_create_config(Some(
                &dir.join("config.toml"),
            )))
            .map_err(|error| anyhow::anyhow!("could not write a config in {dir:?}: {error}"))?;
            // The daemon keeps its database, its lock and its socket in `data_dir`, so a scratch
            // run has to move all three: a config file written elsewhere is not enough.
            config.data_dir = dir.to_path_buf();
            config.socket_path = dir.join("warshad.sock");
            // And OS-chosen ports, because the check starts and stops daemons more than once and
            // a fixed port would make the second start fail for a reason that has nothing to do
            // with what is being proved.
            config.http_port = 0;
            config.ws_port = 0;
            let (data_dir, outcome) = (config.data_dir.clone(), daemon_for(config.clone()));
            (data_dir, outcome, Some(config))
        }
    };
    println!("data dir: {}", data_dir.display());

    let (endpoint, process) = match outcome {
        Ok(started) => started,
        Err(error) => anyhow::bail!("{error}"),
    };
    let host = endpoint.base_url.trim_start_matches("http://").to_string();
    println!(
        "daemon:     {} (started by this process: {})",
        endpoint.base_url, endpoint.owned
    );
    println!("events ws:  {}", endpoint.ws_url);
    println!("token:      {} bytes", endpoint.token.len());

    let mut failures: Vec<String> = Vec::new();
    let check = |failures: &mut Vec<String>, condition: bool, label: &str, detail: &str| {
        if condition {
            println!("PASS  {label}");
        } else {
            println!("FAIL  {label} — {detail}");
            failures.push(label.to_string());
        }
    };

    let authorized = raw_request(&host, &rpc_request(&host, &endpoint.token, "projects.list"));
    match &authorized {
        Ok(response) => check(
            &mut failures,
            response.contains("\"jsonrpc\"") && response.contains("\"result\""),
            "an authorized JSON-RPC call answers",
            &first_line(response),
        ),
        Err(error) => check(
            &mut failures,
            false,
            "an authorized JSON-RPC call answers",
            error,
        ),
    }

    let refused = raw_request(
        &host,
        &rpc_request(&host, "not-the-daemons-token", "projects.list"),
    );
    match &refused {
        Ok(response) => check(
            &mut failures,
            response.contains("unauthorized") || response.contains("invalid token"),
            "a wrong token is refused",
            &first_line(response),
        ),
        Err(error) => check(&mut failures, false, "a wrong token is refused", error),
    }

    let preflight = raw_request(&host, &preflight_request(&host, "http://tauri.localhost"));
    match &preflight {
        Ok(response) => check(
            &mut failures,
            response.contains("200") && response.contains("access-control-allow-origin"),
            "the webview's CORS preflight is answered",
            &first_line(response),
        ),
        Err(error) => check(
            &mut failures,
            false,
            "the webview's CORS preflight is answered",
            error,
        ),
    }

    if scratch.is_some() {
        // The two installer checks live here, in the scratch-only half, for the same reason
        // the restart check does: one of them writes nothing to the daemon it shares with the
        // owner, and the other creates a smoke project and a whole run. Neither has any
        // business touching the owner's real data directory.
        check_health(&mut failures, &endpoint.ws_url);
        check_fake_provider_pipeline(&mut failures, &host, &endpoint.token, &check);
    }

    if let Some(handle) = process {
        tauri::async_runtime::block_on(handle.shutdown());
        println!("daemon stopped (children reaped, lock released)");
    } else {
        println!("daemon was already running: left alone");
    }

    // The lock is what makes a second launch and a restart safe, so it is proved here rather
    // than assumed. Only the scratch directory is used, because this starts and stops daemons
    // over the same data directory twice.
    if let Some(config) = restart_config {
        let lock_failures = restart_safety_report(&config);
        if lock_failures.is_empty() {
            println!("PASS  one daemon holds the data directory, and a restart gets it back");
        } else {
            for label in &lock_failures {
                println!("FAIL  {label}");
            }
            failures.extend(lock_failures);
        }
    }

    if failures.is_empty() {
        println!("self-check: OK");
        Ok(())
    } else {
        anyhow::bail!("self-check failed: {}", failures.join(", "))
    }
}

/// Start, refuse, stop and restart a daemon over `config`'s data directory, and say what did not
/// hold.
///
/// Three facts the desktop's "second window" and "it would not start again" both rest on:
///
/// 1. **one daemon holds the directory** while it runs — a second start is refused, and the
///    refusal names the holder's process id rather than looking like a crash, which is what the
///    shell reads as "there is a daemon already, and it is reachable";
/// 2. **a shutdown gives it back** — the next start over the same data directory succeeds, so an
///    owner who closed the app opens it again without clearing anything by hand;
/// 3. **the file left behind is not the lock** — the lock is the operating system's advisory lock
///    on that file, released when its holder exits, clean or not. That is why a daemon that was
///    killed outright does not lock its own data directory out of use forever, and why the lock
///    file is never deleted (see `warshad`'s `LockFile`: deleting it is how two instances end up
///    locking two different inodes with the same name).
///
/// The failures are returned rather than exited from, so the caller decides whether a failed
/// check ends the run.
fn restart_safety_report(config: &DaemonConfig) -> Vec<String> {
    let mut failures = Vec::new();
    let Ok(first) = tauri::async_runtime::block_on(warshad::start_daemon(config.clone())) else {
        failures.push(format!(
            "a daemon could not start over {}",
            config.data_dir.display()
        ));
        return failures;
    };

    match tauri::async_runtime::block_on(warshad::start_daemon(config.clone())) {
        Err(warshad::DaemonError::Lock(reason)) => {
            println!("second daemon refused, as it must: {reason}");
        }
        Err(other) => failures.push(format!(
            "a second daemon on the same data directory failed for the wrong reason: {other}"
        )),
        Ok(duplicate) => {
            // Two daemons over one data directory is how an owner's settings get written twice
            // at once, so it is ended here rather than left running for the next check.
            tauri::async_runtime::block_on(duplicate.shutdown());
            failures.push(
                "a second daemon started over a data directory another daemon was holding"
                    .to_string(),
            );
        }
    }

    tauri::async_runtime::block_on(first.shutdown());

    match tauri::async_runtime::block_on(warshad::start_daemon(config.clone())) {
        Ok(restarted) => tauri::async_runtime::block_on(restarted.shutdown()),
        Err(error) => failures.push(format!(
            "the data directory was not reusable after a clean shutdown: {error}"
        )),
    }
    failures
}

/// The status line of an HTTP response, for the one-line report.
fn first_line(response: &str) -> String {
    response
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// `get_config` — the value of one shell config key.
#[tauri::command]
fn get_config(key: String, state: State<'_, ShellState>) -> Result<String, String> {
    Ok(state.get(&key))
}

/// `set_config` — store one webview preference. The daemon keys are read-only.
#[tauri::command]
fn set_config(key: String, value: String, state: State<'_, ShellState>) -> Result<(), String> {
    state.set(&key, &value)
}

/// Build and run the app: start the daemon, publish where it is, and reap it on exit.
///
/// The daemon starts *before* the window is created, and synchronously. The webview's first
/// `get_config` therefore cannot race the daemon's ports, which is the failure mode a background
/// start would introduce: the frontend would read an empty `daemon_url` and fall back to its
/// development defaults.
pub fn run() -> anyhow::Result<()> {
    let (data_dir, outcome) = start_shell();
    let settings_path = data_dir.join(SETTINGS_FILE);
    let log_path = data_dir.join(LOG_FILE);

    let (endpoint, process, startup_error) = match outcome {
        Ok((endpoint, process)) => (endpoint, process, None),
        Err(error) => (
            DaemonEndpoint {
                base_url: String::new(),
                ws_url: String::new(),
                token: String::new(),
                owned: false,
            },
            None,
            Some(error),
        ),
    };

    let shell = ShellState {
        endpoint,
        process: Mutex::new(process),
        settings: Mutex::new(read_settings(&settings_path)),
        settings_path,
        log_path,
    };
    if let Some(error) = startup_error {
        shell.note(&error);
    } else if shell.endpoint.owned {
        shell.note(&format!("daemon started on {}", shell.endpoint.base_url));
    } else {
        shell.note("using a daemon another instance already started");
    }

    let app = tauri::Builder::default()
        .manage(shell)
        .invoke_handler(tauri::generate_handler![get_config, set_config])
        .build(tauri::generate_context!())?;

    app.run(|handle, event| {
        // The daemon is this process's own, so it has to be stopped here: a daemon that is
        // dropped rather than shut down leaves its preview servers and MCP stdio processes
        // behind, and the next launch finds a data directory whose ports are taken.
        // `DaemonHandle::shutdown` stops the RPC server, aborts the HTTP task, kills and waits
        // for every child it spawned, and closes the lock handle.
        //
        // The paths that never reach this callback — a `build()` that fails, a `?` between the
        // start and the event loop, a panic unwinding through the shell — are covered by
        // `DaemonHandle`'s own `Drop`, which runs the same child sweep on a thread that may
        // block for it. And a process that is killed outright takes this daemon down with it
        // because it was never a separate `warshad`: the shell's own exit is the daemon's exit,
        // which is the reason there is no orphan `warshad` to find in the first place.
        if let RunEvent::Exit = event {
            let state = handle.state::<ShellState>();
            let owned = state
                .process
                .lock()
                .ok()
                .and_then(|mut process| process.take());
            if let Some(handle) = owned {
                tauri::async_runtime::block_on(handle.shutdown());
                state.note("daemon stopped");
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Keys the frontend writes today, and the ones a restart has to give back.
    const APP_MODE: &str = "app_mode";
    const THEME: &str = "theme";

    /// A scratch directory next to the test binary, not in `%TEMP%`.
    ///
    /// The operating system's temp directory is the conventional choice and the one this
    /// machine's sandbox denies to a freshly built test executable, which would make an
    /// environment tell the owner the settings code is broken. The directory the binary
    /// itself lives in is always writable by it, and each test gets its own name under it,
    /// cleared before use so a run never reads a previous run's file.
    fn scratch(tag: &str) -> PathBuf {
        let root = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("warsha-desktop-tests");
        let directory = root.join(tag);
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("the scratch directory is made");
        directory
    }

    /// A shell state over one scratch directory, with no daemon in it.
    fn shell(directory: &Path) -> ShellState {
        ShellState {
            endpoint: DaemonEndpoint {
                base_url: "http://127.0.0.1:1234".to_string(),
                ws_url: "ws://127.0.0.1:4321".to_string(),
                token: "a-token".to_string(),
                owned: false,
            },
            process: Mutex::new(None),
            settings: Mutex::new(read_settings(&directory.join(SETTINGS_FILE))),
            settings_path: directory.join(SETTINGS_FILE),
            log_path: directory.join(LOG_FILE),
        }
    }

    #[test]
    fn a_preference_the_owner_sets_is_where_the_next_launch_looks_for_it() {
        let directory = scratch("settings-round-trip");
        let first = shell(&directory);
        first.set(APP_MODE, "advanced").expect("app_mode is stored");
        first.set(THEME, "dark").expect("theme is stored");

        // The next launch: a new state, read from the same file, with nothing remembered
        // in memory. This is the whole of "mode and theme survive a restart".
        let second = shell(&directory);
        assert_eq!(second.get(APP_MODE), "advanced");
        assert_eq!(second.get(THEME), "dark");

        // And the file on disk is the settings file in the daemon's data directory, so one
        // directory is the whole install for a backup or a removal.
        let on_disk: BTreeMap<String, String> = serde_json::from_str(
            &std::fs::read_to_string(directory.join(SETTINGS_FILE)).expect("the file is readable"),
        )
        .expect("the file is the settings map");
        assert_eq!(on_disk[APP_MODE], "advanced");
        assert_eq!(on_disk[THEME], "dark");
    }

    #[test]
    fn the_three_daemon_keys_are_answered_by_the_shell_and_cannot_be_written() {
        let directory = scratch("shell-owned-keys");
        let state = shell(&directory);

        for key in SHELL_OWNED_KEYS {
            assert_eq!(
                state.set(key, "http://elsewhere"),
                Err(format!("{key} is reported by the shell and cannot be set")),
                "{key} is the shell's to answer"
            );
        }

        // A stale `desktop.json` that names those keys anyway cannot redirect the frontend,
        // because they are read from the endpoint, not the file.
        let stale = r#"{"daemon_url":"http://127.0.0.1:9","daemon_token":"not-it"}"#;
        std::fs::write(directory.join(SETTINGS_FILE), stale).expect("the stale file is placed");
        let reloaded = shell(&directory);
        assert_eq!(reloaded.get(CONFIG_DAEMON_URL), "http://127.0.0.1:1234");
        assert_eq!(reloaded.get(CONFIG_DAEMON_TOKEN), "a-token");
    }

    #[test]
    fn a_write_keeps_the_keys_another_writer_stored() {
        let directory = scratch("settings-merge");
        let first = shell(&directory);
        first
            .set("routine_enabled", "true")
            .expect("the first key is stored");

        // A second state over the same file, which is what a second window of the same
        // install is: it read the file at start, and its write must not be the whole file
        // as it remembers it.
        let second = shell(&directory);
        second
            .set(THEME, "light")
            .expect("the second key is stored");

        assert_eq!(
            second.get("routine_enabled"),
            "true",
            "the other window's key is still there"
        );
        assert_eq!(second.get(THEME), "light");

        // And the first writer sees the second's change on its next read of the file.
        let reloaded = shell(&directory);
        assert_eq!(reloaded.get(THEME), "light");
        assert_eq!(reloaded.get("routine_enabled"), "true");
    }

    #[test]
    fn a_write_leaves_no_scratch_file_and_an_unnamed_key_is_refused() {
        let directory = scratch("settings-atomic");
        let state = shell(&directory);
        for index in 0..8 {
            state.set("counter", &index.to_string()).expect("a rewrite");
        }
        assert_eq!(state.get("counter"), "7");

        let mut leftovers: Vec<String> = std::fs::read_dir(&directory)
            .expect("the directory reads")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with('.'))
            .collect();
        leftovers.sort();
        assert!(
            leftovers.is_empty(),
            "a completed write renames its scratch file away: {leftovers:?}"
        );

        assert!(state.set("   ", "value").is_err(), "a key has to be named");
    }

    #[test]
    fn a_file_that_does_not_parse_reads_as_empty_which_is_why_writes_are_renamed() {
        let directory = scratch("settings-corrupt");
        std::fs::write(directory.join(SETTINGS_FILE), b"{\"app_mode\": \"adv")
            .expect("the truncated file is placed");
        // The documented consequence: an unreadable settings file is an empty map, so a
        // half-written file would silently be an owner who never chose a mode. The atomic
        // rename is what makes this state unreachable from a crash mid-write.
        assert!(read_settings(&directory.join(SETTINGS_FILE)).is_empty());
    }

    #[test]
    fn the_webview_origins_are_added_once_and_the_endpoint_matches_the_configuration() {
        let config = warshad::DaemonConfig {
            http_port: 8765,
            ws_port: 8766,
            auth_token: "the-token".to_string(),
            ..warshad::DaemonConfig::default()
        };
        let configured = config.clone();

        let once = with_webview_origins(config.clone());
        let twice = with_webview_origins(once.clone());
        assert_eq!(
            once.allowed_origins, twice.allowed_origins,
            "adding the webview's origins is idempotent: a second pass must not grow the list"
        );
        for origin in webview_origins() {
            assert!(
                once.allowed_origins.contains(&origin),
                "{origin} is the origin the webview asks from"
            );
        }

        // A daemon the shell does not own is described by the configuration both processes
        // read: the RPC port is `ws_port` and the events socket is `http_port`, which is the
        // one mapping that lets a second window reach the daemon the first one started.
        let endpoint = configured_endpoint(&configured);
        assert_eq!(endpoint.base_url, "http://127.0.0.1:8766");
        assert_eq!(endpoint.ws_url, "ws://127.0.0.1:8765");
        assert_eq!(endpoint.token, "the-token");
        assert!(
            !endpoint.owned,
            "the shell does not own what it did not start"
        );
    }

    #[test]
    fn a_note_is_appended_to_the_log_the_installer_points_at() {
        let directory = scratch("settings-log");
        let state = shell(&directory);
        state.note("first");
        state.note("second");
        let log = std::fs::read_to_string(directory.join(LOG_FILE)).expect("the log is readable");
        assert!(log.contains("first") && log.contains("second"), "{log}");
        // One stamped line per note, so a report can be read in order.
        assert_eq!(log.lines().count(), 2, "{log}");
    }

    /// The bundle file this test reads, resolved from the crate directory rather than the
    /// current working directory: `cargo test` runs the test binary from inside `target/`,
    /// and the manifest is a sibling of `src/`, not of anything under `target/`.
    fn tauri_config_text() -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{} must be readable: {error}", path.display()))
    }

    #[test]
    fn the_shipped_config_builds_unsigned_and_ships_no_active_updater() {
        // The Windows NSIS installer ships unsigned: no code-signing certificate and no
        // updater minisign key exist for this release. A `true` here makes `tauri build`
        // demand `TAURI_SIGNING_PRIVATE_KEY` and fail the packaging run, and an active
        // `plugins.updater` would ship a window pointed at an endpoint that publishes no
        // signed artifacts (it 404s). Both are refused by this test, which reads the very
        // file `tauri build` consumes, so the packaged install and the checked-in config
        // can never disagree.
        let config: serde_json::Value =
            serde_json::from_str(&tauri_config_text()).expect("tauri.conf.json is valid JSON");

        assert_eq!(
            config["bundle"]["createUpdaterArtifacts"].as_bool(),
            Some(false),
            "bundle.createUpdaterArtifacts must be false so an unsigned build needs no signing key"
        );

        match config
            .get("plugins")
            .and_then(|plugins| plugins.get("updater"))
        {
            None => {}
            Some(updater) => assert_ne!(
                updater.get("active").and_then(serde_json::Value::as_bool),
                Some(true),
                "plugins.updater must not be active: the updater endpoint ships no signed artifact"
            ),
        }
    }
}
