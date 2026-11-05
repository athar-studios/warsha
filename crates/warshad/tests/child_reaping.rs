//! D2 — the daemon reaps its children when it shuts down (PLAN.md M20).
//!
//! The child is this test binary, re-executed with `--exact <probe>`: a real
//! long-running process the daemon starts through its own `process.spawn` RPC and
//! then has to kill *and wait for* at shutdown. Nothing here needs a shell, and
//! nothing depends on how this platform spells "is that pid alive" in a way the
//! operating system is not asked about.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use reqwest::Client;
use serde_json::{json, Value};
use tempfile::TempDir;
use warshad::{start_daemon, DaemonConfig};

/// The token the daemon under test is started with.
const TEST_TOKEN: &str = "child-reaping-token";

/// The environment variable the probe is told to write its pid to.
const PID_FILE_ENV: &str = "WARSHA_REAP_PID_FILE";

/// A fresh temp directory for one daemon's data dir.
///
/// Prefers cargo's `CARGO_TARGET_TMPDIR`, then a `tmp` sibling of the test
/// binary's `deps` directory (the target dir is writable wherever the build
/// ran), and only then the system temp dir — which on some Windows machines is
/// protected and rejects even creating a tempdir (`Access is denied`).
fn fresh_tempdir() -> TempDir {
    if let Some(base) = std::env::var_os("CARGO_TARGET_TMPDIR") {
        let base = PathBuf::from(base);
        if base.is_dir() {
            if let Ok(dir) = TempDir::new_in(&base) {
                return dir;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(deps) = exe.parent() {
            let base = deps.join("tmp");
            if std::fs::create_dir_all(&base).is_ok() {
                if let Ok(dir) = TempDir::new_in(&base) {
                    return dir;
                }
            }
        }
    }
    TempDir::new().expect("tempdir for the daemon data dir")
}

/// A child that stays alive until the daemon kills it.
///
/// A daemon starts a child with the arguments it was given, so the probe
/// identifies itself by `--exact` and is told where to write through the
/// environment. `--ignored` selects an ignored test and `--nocapture` keeps
/// libtest from buffering anything; the guard makes the probe harmless if a full
/// ignored run ever reaches it, because only a run pointed at `--exact` is a child
/// of a test. The pid is written before the sleep, so the parent can watch the
/// exact process rather than guess.
#[test]
#[ignore = "a child process, not a test"]
fn reap_probe_child() {
    if !std::env::args().any(|arg| arg == "--exact") {
        return;
    }
    let path = std::env::var(PID_FILE_ENV).expect("the pid file is named in the environment");
    std::fs::write(&path, std::process::id().to_string()).expect("the pid is written");
    std::thread::sleep(Duration::from_secs(120));
}

/// Whether the operating system still knows a pid.
///
/// The OS is the judge, not the daemon's own record: a pid that is gone proves the
/// child was killed and waited for, and one that answers proves it is still there
/// — a zombie included, which is exactly what "killed but never reaped" looks
/// like. A machine that cannot run the query fails the test loudly instead of
/// reading as "reaped".
#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("`kill` is available to ask the OS about a pid")
        .success()
}

/// Whether the operating system still knows a pid (Windows half).
#[cfg(windows)]
fn pid_is_alive(pid: u32) -> bool {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .expect("`tasklist` is available to ask the OS about a pid");
    String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
}

/// Wait for the probe to report its pid, or fail saying it never did.
async fn wait_for_pid(path: &Path) -> u32 {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(pid) = text.trim().parse::<u32>() {
                return pid;
            }
        }
        assert!(
            Instant::now() < deadline,
            "the child never wrote its pid to {}",
            path.display()
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// A daemon configuration over one data directory, on OS-chosen ports.
fn config(data_dir: &Path) -> DaemonConfig {
    DaemonConfig {
        data_dir: data_dir.to_path_buf(),
        socket_path: data_dir.join("warshad.sock"),
        http_port: 0,
        ws_port: 0,
        auth_token: TEST_TOKEN.to_string(),
        allowed_origins: vec!["http://localhost:5173".to_string()],
        // The child this test starts is its own binary, so the daemon's configuration
        // is what admits that exact path. An allow-list is the owner's: nothing on the
        // RPC can add to it (audit H-05).
        allowed_commands: current_program(),
        rate_limits: warshad::RateLimitConfig::default(),
        // The bind address keeps the loopback default and nothing is advertised:
        // this daemon is only ever dialed from the test process on this machine.
        ..DaemonConfig::default()
    }
}

/// The test binary as a program the daemon may start, or no list at all when the
/// process cannot name itself.
fn current_program() -> Vec<String> {
    std::env::current_exe()
        .ok()
        .map(|exe| vec![exe.to_string_lossy().into_owned()])
        .unwrap_or_default()
}

/// One daemon's RPC surface.
struct Rpc {
    client: Client,
    rpc_port: u16,
}

impl Rpc {
    /// A client for one daemon's RPC port.
    fn new(rpc_port: u16) -> Self {
        let client = Client::builder()
            .default_headers({
                let mut headers = reqwest::header::HeaderMap::new();
                headers.insert(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {TEST_TOKEN}")
                        .parse()
                        .expect("a valid auth header"),
                );
                headers
            })
            .build()
            .expect("a reqwest client");
        Rpc { client, rpc_port }
    }

    /// Call one method and hand back its `result`.
    async fn call(&self, method: &str, params: Value) -> Value {
        let response = self
            .client
            .post(format!("http://127.0.0.1:{}", self.rpc_port))
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params,
            }))
            .send()
            .await
            .expect("the RPC request is sent");
        assert_eq!(
            response.status(),
            reqwest::StatusCode::OK,
            "{method} answered HTTP {}",
            response.status()
        );
        let body = response
            .json::<Value>()
            .await
            .expect("the response is JSON");
        assert!(
            body.get("error").is_none(),
            "{method} failed: {}",
            body["error"]
        );
        body["result"].clone()
    }

    /// Start `exe --exact reap_probe_child …`, told where to write its pid.
    async fn spawn_probe(&self, exe: &Path, pid_file: &Path) -> String {
        let id = self
            .call(
                "process.spawn",
                json!([
                    exe.to_string_lossy(),
                    ["--exact", "reap_probe_child", "--ignored", "--nocapture"],
                    { PID_FILE_ENV: pid_file.to_string_lossy() },
                ]),
            )
            .await;
        id.as_str()
            .expect("the daemon names the child it started")
            .to_string()
    }
}

#[tokio::test]
async fn shutting_the_daemon_down_kills_and_reaps_every_child() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().to_path_buf();
    let exe = std::env::current_exe().expect("the test binary names itself");

    let handle = start_daemon(config(&data_dir))
        .await
        .expect("the daemon starts");
    let rpc = Rpc::new(handle.rpc_port());

    // Two children, so this is the sweep and not one lucky process: both are
    // started through the daemon's own `process.spawn`, which is the same manager
    // the MCP stdio transport and the live preview start their children on.
    let first_file = data_dir.join("child-1.pid");
    let second_file = data_dir.join("child-2.pid");
    let first_id = rpc.spawn_probe(&exe, &first_file).await;
    let second_id = rpc.spawn_probe(&exe, &second_file).await;

    let first_pid = wait_for_pid(&first_file).await;
    let second_pid = wait_for_pid(&second_file).await;
    assert!(pid_is_alive(first_pid), "child {first_pid} is running");
    assert!(pid_is_alive(second_pid), "child {second_pid} is running");
    assert_eq!(
        rpc.call("process.status", json!([first_id])).await,
        json!("running")
    );
    assert_eq!(
        rpc.call("process.status", json!([second_id])).await,
        json!("running")
    );

    handle.shutdown().await;

    // `shutdown` awaits each child, so by the time it returns the pids are gone —
    // the short poll only tolerates a slow OS, not a surviving child.
    let deadline = Instant::now() + Duration::from_secs(5);
    while (pid_is_alive(first_pid) || pid_is_alive(second_pid)) && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        !pid_is_alive(first_pid),
        "child {first_pid} outlived the daemon that started it"
    );
    assert!(
        !pid_is_alive(second_pid),
        "child {second_pid} outlived the daemon that started it"
    );
}

#[tokio::test]
async fn a_child_that_already_exited_does_not_stop_a_shutdown() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().to_path_buf();
    let exe = std::env::current_exe().expect("the test binary names itself");
    let pid_file: PathBuf = data_dir.join("child.pid");

    let handle = start_daemon(config(&data_dir))
        .await
        .expect("the daemon starts");
    let rpc = Rpc::new(handle.rpc_port());

    let id = rpc.spawn_probe(&exe, &pid_file).await;
    let pid = wait_for_pid(&pid_file).await;

    // The owner stops it first, which is the ordinary path: a child that is
    // already gone must not make the shutdown sweep fail on the ones that are not.
    rpc.call("process.stop", json!([id])).await;
    assert_eq!(
        rpc.call("process.status", json!([id])).await,
        json!("stopped")
    );

    handle.shutdown().await;
    assert!(
        !pid_is_alive(pid),
        "child {pid} was stopped, not left running"
    );
}

/// The handle dropped *without* a shutdown still takes its children down.
///
/// This is the path the desktop shell lands on when the daemon starts and the app never
/// reaches its exit handler: a `build()` that fails, a `?` between the start and the
/// event loop, a panic unwinding. Before C2 the children of such a daemon were simply
/// forgotten — a preview server or an MCP stdio process holding a port after the thing
/// that started it was gone, which is the orphan the board names.
///
/// It runs on a multi-thread runtime deliberately. `Drop` cannot await, so the sweep is
/// handed to a thread that may block on the runtime; on the default single-thread
/// `#[tokio::test]` runtime the only worker is the thread that is inside `Drop`, so the
/// sweep would wait on the very thread waiting on it and time out. A real daemon — the
/// `warshad` binary, or the shell's `tauri::async_runtime` — is multi-threaded, and that
/// is the situation being proved.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_handle_dropped_without_a_shutdown_still_reaps_its_children() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().to_path_buf();
    let exe = std::env::current_exe().expect("the test binary names itself");

    let handle = start_daemon(config(&data_dir))
        .await
        .expect("the daemon starts");
    let rpc = Rpc::new(handle.rpc_port());

    let pid_file = data_dir.join("dropped-child.pid");
    let id = rpc.spawn_probe(&exe, &pid_file).await;
    let pid = wait_for_pid(&pid_file).await;
    assert!(pid_is_alive(pid), "child {pid} is running");
    assert_eq!(
        rpc.call("process.status", json!([id])).await,
        json!("running")
    );

    // No `shutdown`: the handle is dropped, which is what the shell's error paths do.
    drop(handle);

    let deadline = Instant::now() + Duration::from_secs(8);
    while pid_is_alive(pid) && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        !pid_is_alive(pid),
        "child {pid} outlived a daemon whose handle was dropped without a shutdown"
    );
}

/// A clean shutdown gives the data directory back, and the lock file stays where it is.
///
/// The lock that matters is the operating system's advisory lock on the file, not the
/// file's existence — which is why a restart needs no cleanup step, why a daemon that
/// was killed outright never locks its own directory out of use, and why deleting the
/// file on exit would be the bug: an instance that unlinked it while another held a
/// handle to the old inode lets the next one lock a *different* file under the same
/// name, and two daemons end up sharing a data directory.
#[tokio::test]
async fn a_restart_takes_the_data_directory_back_and_the_lock_file_stays() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().to_path_buf();
    let lock_file = data_dir.join("warshad.lock");

    let first = start_daemon(config(&data_dir))
        .await
        .expect("the first daemon starts");
    assert!(
        lock_file.is_file(),
        "the lock file is made by the first daemon to take the directory"
    );
    first.shutdown().await;

    // Still there, and still no obstacle: the lock it carries was released with the
    // handle, so a second daemon over the same directory simply starts.
    assert!(
        lock_file.is_file(),
        "a clean shutdown leaves the lock file in place rather than deleting it"
    );
    let second = start_daemon(config(&data_dir))
        .await
        .expect("a second daemon starts over the same data directory after a shutdown");

    // And while it is held again, the refusal names the holder's process id — the one
    // fact that turns "the app will not start" into a thing an owner can act on.
    let held = std::process::id().to_string();
    let refused = start_daemon(config(&data_dir)).await;
    let error = match refused {
        Ok(duplicate) => {
            duplicate.shutdown().await;
            panic!("a second daemon started while the directory was held");
        }
        Err(error) => error,
    };
    assert!(
        error.to_string().contains(&held),
        "the refusal says which process holds it: {error}"
    );

    second.shutdown().await;
}
