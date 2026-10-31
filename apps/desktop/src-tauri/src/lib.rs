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
            _ => self
                .settings
                .lock()
                .map(|settings| settings.get(key).cloned().unwrap_or_default())
                .unwrap_or_default(),
        }
    }

    /// Persist `key = value` for the webview's own keys.
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        if SHELL_OWNED_KEYS.contains(&key) {
            return Err(format!("{key} is reported by the shell and cannot be set"));
        }
        let snapshot = {
            let mut settings = self
                .settings
                .lock()
                .map_err(|_| "the settings lock was poisoned".to_string())?;
            settings.insert(key.to_string(), value.to_string());
            settings.clone()
        };
        write_settings(&self.settings_path, &snapshot)
    }

    /// Append one line to the shell's log, best effort: a log that cannot be written must not be
    /// the reason the app fails to start.
    fn note(&self, message: &str) {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default();
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
        {
            let _ = writeln!(file, "[{stamp}] {message}");
        }
    }
}

/// Read the shell's settings file; a missing or unreadable file is simply an empty map.
fn read_settings(path: &Path) -> BTreeMap<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Write the shell's settings file, creating its directory if it is not there yet.
fn write_settings(path: &Path, settings: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("{parent:?}: {error}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    std::fs::write(path, json).map_err(|error| format!("{path:?}: {error}"))
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
        Err(DaemonError::Lock(_)) => Ok((configured_endpoint(&config), None)),
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

/// `--self-check [--data-dir <path>]` — start the daemon exactly as the window does, prove the
/// webview could reach it, and stop it again. Returns an error naming every check that failed.
///
/// This exists because the half of this app that needs no window is the half that breaks in
/// silence: a host that cannot create a webview (a headless CI runner, a locked-down session) still
/// has to be able to answer "does `warshad` start, and can the frontend reach it?".
///
/// `--data-dir` points the check at a scratch directory instead of the owner's real one, which is
/// what a CI runner wants: the check must not touch the projects of whoever runs it.
pub fn self_check(scratch: Option<&Path>) -> anyhow::Result<()> {
    let (data_dir, outcome) = match scratch {
        None => start_shell(),
        Some(dir) => {
            let mut config = tauri::async_runtime::block_on(warshad::load_or_create_config(Some(
                &dir.join("config.toml"),
            )))
            .map_err(|error| anyhow::anyhow!("could not write a config in {dir:?}: {error}"))?;
            // The daemon keeps its database, its lock and its socket in `data_dir`, so a scratch
            // run has to move all three: a config file written elsewhere is not enough.
            config.data_dir = dir.to_path_buf();
            config.socket_path = dir.join("warshad.sock");
            (config.data_dir.clone(), daemon_for(config))
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

    if let Some(handle) = process {
        tauri::async_runtime::block_on(handle.shutdown());
        println!("daemon stopped (children reaped, lock released)");
    } else {
        println!("daemon was already running: left alone");
    }

    if failures.is_empty() {
        println!("self-check: OK");
        Ok(())
    } else {
        anyhow::bail!("self-check failed: {}", failures.join(", "))
    }
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
        // The daemon is this process's own: it has to be stopped here, or the next launch finds
        // the data directory still locked. `DaemonHandle::shutdown` stops the RPC server, aborts
        // the HTTP task, kills and reaps every child it spawned, and releases the lock file.
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
