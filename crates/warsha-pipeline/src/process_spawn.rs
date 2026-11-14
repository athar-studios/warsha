//! Process spawning — the real child processes behind `process.*` and the live
//! preview dev server (PLAN.md M20).
//!
//! Everything here starts an actual OS process through [`tokio::process`]. That
//! is the whole point of the module: the live preview panel needed something to
//! run `npm run dev` with, and the MCP stdio transport needed something to start
//! an MCP server, so both go through [`ProcessManager`] and one manager owns
//! every child the daemon spawns.
//!
//! Five properties are deliberate:
//!
//! - **The handle stays here.** [`ManagedProcess`] carries the
//!   `tokio::process::Child`, and [`ProcessManager::list`] hands back the same
//!   record with `child: None`, so a caller can read a process but not steal it.
//! - **A status is observed, not remembered.** [`ProcessStatus::Starting`] is
//!   what a spawn records; the first `status`/`list`/`stop` call asks
//!   `try_wait()`, which promotes it to [`ProcessStatus::Running`] or settles it
//!   as [`ProcessStatus::Stopped`] (exit code 0) or [`ProcessStatus::Crashed`]
//!   (any other exit). [`ProcessStatus::Failed`] means the wait itself failed.
//! - **The environment survives a restart.** [`ManagedProcess`] keeps exactly the
//!   six documented fields, so the environment a spawn was given is stored beside
//!   the record and replayed by [`ProcessManager::restart`].
//! - **A restart re-checks the policy.** The manager holds the command policy it
//!   was built with, and [`ProcessManager::restart`] judges the stored program and
//!   its arguments again before it re-spawns, so a configuration narrowed after a
//!   spawn cannot re-launch a program the daemon would now refuse (KEEL checkpoint
//!   finding M4). The check runs before the running child is touched, so a refused
//!   restart leaves the process as it was.
//! - **The environment is cleared, not inherited.** Every child starts from
//!   `env_clear()` and the fixed [`MINIMAL_CHILD_ENV`] floor; the only other
//!   variables it sees are the ones the caller named, and a caller cannot
//!   replace `PATH` or hand a loader variable to the program. A provider key or
//!   bearer token in the daemon's environment therefore cannot reach a child by
//!   inheritance (KEEL K5a).
//! - **stdout and stderr are pipes the manager owns.** stdin is piped (the MCP
//!   transport's frame sink), stdout is captured per process (the MCP handshake
//!   reads a reply and the live preview reads the URL a dev server prints), and
//!   stderr is captured too, **redacted** through
//!   [`crate::guardrails::mask_secrets`] and re-emitted as a `tracing` event
//!   instead of being inherited. A server cannot put a token on the daemon's
//!   console by logging it. A bounded ring ([`MAX_CAPTURED_LINES`]) keeps the
//!   newest lines of each stream, so a chatty server cannot grow the daemon's
//!   memory without bound.
//! - **Children are reaped on request, not on drop.** [`ProcessManager::kill_all`]
//!   kills and waits for every live child, and the daemon's shutdown is what
//!   calls it: an OS child cannot be awaited in `Drop`, so an exit path has to
//!   name it explicitly. A daemon restart that never runs that path forgets the
//!   processes it started, which is recorded as the remaining half in PLAN.md.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWriteExt};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::command_policy::{child_path, CommandPolicy, MINIMAL_CHILD_ENV};

/// Environment names a spawn may not hand to a child, whatever its caller asks.
///
/// These are the same loader/interpreter hooks the daemon's process policy
/// refuses at the RPC seam; refusing them here as well means a caller that
/// reaches the manager by another route still cannot turn an environment
/// variable into code execution (KEEL K5a).
const DENIED_CHILD_ENV_KEYS: &[&str] = &[
    "PATH",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "NODE_OPTIONS",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "PERL5OPT",
    "RUBYOPT",
    "GEM_PATH",
    "CARGO",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "SHELL",
    "BASH_ENV",
    "ENV",
];

/// How many stdout lines the manager keeps per process.
///
/// A dev server prints its banner and then keeps logging; the ring keeps the
/// newest lines and drops the oldest, so a server that outlives the daemon's
/// patience cannot grow its memory without bound.
pub const MAX_CAPTURED_LINES: usize = 500;

/// The wall-clock bound for one stdin write to a child.
pub const STDIN_WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// The most bytes one captured line keeps before it is truncated.
///
/// [`BufReader::lines`] built a whole line before redacting, so a child that
/// printed one 2 MiB line without a newline could grow the daemon's memory
/// without bound (KEEL K5 independent review, finding 4). A line longer than
/// this is cut and marked with [`TRUNCATION_MARKER`].
pub const MAX_CAPTURED_LINE_BYTES: usize = 16 * 1024;

/// The most bytes a stderr ring keeps; the oldest lines are dropped first.
pub const MAX_CAPTURED_STDERR_BYTES: usize = 256 * 1024;

/// The marker a line carries when it hit [`MAX_CAPTURED_LINE_BYTES`].
pub const TRUNCATION_MARKER: &str = "…[truncated]";

/// Values shorter than this are not treated as known secrets when masking env.
///
/// A resolved keychain secret is long; masking one-character values would
/// mangle ordinary diagnostics without adding protection.
const MIN_MASKED_ENV_VALUE_BYTES: usize = 8;

/// How long [`LivePreviewManager::start`] waits for the dev server to print a URL.
///
/// A server that prints nothing in that time leaves the preview's `url` as `None`
/// rather than guessing a port, and `status` re-reads the transcript afterwards,
/// so a late banner still shows up.
pub const PREVIEW_URL_TIMEOUT: Duration = Duration::from_secs(3);

/// How often that wait looks again at what the server has printed.
const URL_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Seconds since the Unix epoch, or `0` on a clock that cannot answer.
///
/// A started-at timestamp is diagnostic, not a decision, so a host whose clock
/// sits before 1970 reports `0` rather than failing a spawn.
fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// Where a managed process is in its life.
///
/// `Starting` is the state a spawn records and the first observation promotes;
/// the three terminal states are `Stopped`, `Crashed` and `Failed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessStatus {
    /// Spawned, not yet observed running.
    Starting,
    /// Spawned and still alive.
    Running,
    /// Exited on its own with code 0, or was stopped on request.
    Stopped,
    /// The wait itself failed, so the status is unknown.
    Failed,
    /// Exited with a non-zero code.
    Crashed,
}

impl ProcessStatus {
    /// Stable snake_case tag; also the serde representation the RPC returns.
    pub fn as_str(self) -> &'static str {
        match self {
            ProcessStatus::Starting => "starting",
            ProcessStatus::Running => "running",
            ProcessStatus::Stopped => "stopped",
            ProcessStatus::Failed => "failed",
            ProcessStatus::Crashed => "crashed",
        }
    }

    /// True for the three states a process never leaves.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            ProcessStatus::Stopped | ProcessStatus::Failed | ProcessStatus::Crashed
        )
    }
}

/// One process the manager owns.
///
/// The child handle is the manager's: `list()` returns the same record with
/// `child: None`, and the serde form of the handle is nothing at all, so an RPC
/// caller never receives something it could wait on.
#[derive(Debug, Serialize)]
pub struct ManagedProcess {
    /// Manager-assigned id, unique for the manager's lifetime.
    pub id: String,
    /// The program that was started, exactly as it was spelled.
    pub command: String,
    /// Its arguments, in order.
    pub args: Vec<String>,
    /// The live handle; `None` once the process has been reaped or listed.
    #[serde(skip)]
    pub child: Option<Child>,
    /// The last observed status.
    pub status: ProcessStatus,
    /// Spawn time in whole seconds since the Unix epoch.
    pub started_at: Option<u64>,
    /// The exit code, once the process has been reaped and the OS reported one.
    ///
    /// A child killed by a signal has no exit code, so on Unix this stays `None`
    /// after [`ProcessManager::stop`].
    pub exit_code: Option<i32>,
}

impl ManagedProcess {
    /// The same record without the handle, which is what `list()` may hand out.
    pub fn detached(&self) -> ManagedProcess {
        ManagedProcess {
            id: self.id.clone(),
            command: self.command.clone(),
            args: self.args.clone(),
            child: None,
            status: self.status,
            started_at: self.started_at,
            exit_code: self.exit_code,
        }
    }
}

/// A process as a caller may hold it: the same six facts, and no handle.
///
/// [`ManagedProcess`] owns a `tokio::process::Child`, so it is neither `Clone` nor
/// something an RPC result can be — `jsonrpsee` requires a clonable result. This
/// is that record's projection, which is what `process.list` serves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessSummary {
    /// Manager-assigned id.
    pub id: String,
    /// The program that was started.
    pub command: String,
    /// Its arguments.
    pub args: Vec<String>,
    /// The last observed status.
    pub status: ProcessStatus,
    /// Spawn time in whole seconds since the Unix epoch.
    pub started_at: Option<u64>,
    /// The exit code, once the OS reported one.
    pub exit_code: Option<i32>,
}

impl ManagedProcess {
    /// The clonable projection of this record.
    pub fn summary(&self) -> ProcessSummary {
        ProcessSummary {
            id: self.id.clone(),
            command: self.command.clone(),
            args: self.args.clone(),
            status: self.status,
            started_at: self.started_at,
            exit_code: self.exit_code,
        }
    }
}

/// Everything that can go wrong starting, inspecting or stopping a process.
#[derive(Debug, Error)]
pub enum ProcessError {
    /// No process with that id is tracked.
    #[error("no process with id `{0}`")]
    NotFound(String),
    /// The process is tracked but is not alive, so there is nothing to signal.
    #[error("process `{0}` is not running")]
    NotRunning(String),
    /// The program could not be started at all.
    #[error("could not start `{command}`: {source}")]
    Spawn {
        /// The program that failed to start.
        command: String,
        /// Why it failed (missing binary, permissions, …).
        #[source]
        source: std::io::Error,
    },
    /// Writing to the child's stdin did not finish in time.
    #[error("process `{0}` did not accept stdin within the deadline")]
    StdinTimeout(String),
    /// The process was signalled but could not be killed.
    #[error("could not stop process `{id}`: {source}")]
    Stop {
        /// The process that was being stopped.
        id: String,
        /// Why the kill failed.
        #[source]
        source: std::io::Error,
    },
    /// The process exited but could not be inspected.
    #[error("could not inspect process `{id}`: {source}")]
    Inspect {
        /// The process whose wait failed.
        id: String,
        /// Why the wait failed.
        #[source]
        source: std::io::Error,
    },
    /// Bytes could not be written to the child's stdin.
    #[error("could not write to process `{id}`: {source}")]
    Write {
        /// The process the write was aimed at.
        id: String,
        /// Why the write failed.
        #[source]
        source: std::io::Error,
    },
    /// The child has no stdin pipe, so nothing can be written to it.
    #[error("process `{0}` has no stdin pipe")]
    StdInUnsupported(String),
    /// A process needs a program to run.
    #[error("empty command: a process needs a program to run")]
    EmptyCommand,
    /// A single- or double-quoted argument was never closed.
    #[error("unterminated {quote} quote in command")]
    UnterminatedQuote {
        /// The quote character left open (`'` or `"`).
        quote: char,
    },
    /// A preview needs a project to belong to.
    #[error("empty project id: a preview needs a project")]
    EmptyProjectId,
    /// A project already has a live dev server.
    #[error("project `{0}` already has a running preview")]
    PreviewAlreadyRunning(String),
    /// Another live run owns this project's live dev server (R-BRIDGE-B5 D3).
    #[error(
        "project `{project}` already has a running preview owned by run `{owner}`; \
         run `{run_id}` cannot take it"
    )]
    PreviewOwnedByRun {
        /// The project whose server is already up.
        project: String,
        /// The live run that owns it.
        owner: String,
        /// The run that asked for a server of its own.
        run_id: String,
    },
    /// The command policy refuses the stored command, so it may not be re-spawned.
    #[error("process `{id}` cannot restart: {reason}")]
    PolicyRefused {
        /// The process whose stored command was refused.
        id: String,
        /// The policy's own refusal message.
        reason: String,
    },
    /// No preview is tracked for that project.
    #[error("no preview for project `{0}`")]
    PreviewNotFound(String),
}

/// Start, stop and observe OS processes.
#[async_trait]
pub trait ProcessManager: Send + Sync {
    /// Start `command` with `args` and `env`, returning the new process id.
    async fn spawn(
        &self,
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<String, ProcessError>;

    /// Kill the process and mark it stopped.
    async fn stop(&self, id: &str) -> Result<(), ProcessError>;

    /// The process's current status, observed rather than remembered.
    async fn status(&self, id: &str) -> Result<ProcessStatus, ProcessError>;

    /// Every tracked process, in spawn order, without the child handles.
    async fn list(&self) -> Vec<ManagedProcess>;

    /// Kill the process if it is alive and start the same command again under
    /// the same id, with the same arguments and the same environment.
    ///
    /// The stored command is judged again by the policy the manager was built
    /// with before anything is spawned, and a refused command leaves the running
    /// child alone: a policy narrowed after a spawn cannot re-launch a program the
    /// daemon would now refuse.
    async fn restart(&self, id: &str) -> Result<String, ProcessError>;

    /// The stdout lines the process has printed, oldest first, from `offset` on.
    ///
    /// A reader keeps its own cursor and asks for what came after it, which is
    /// how the MCP handshake reads one reply at a time. Only the newest
    /// [`MAX_CAPTURED_LINES`] are kept, so a reader that falls further behind
    /// than that has lost the lines it did not ask for yet — and an offset past
    /// the end is an empty list, not an error.
    async fn read_stdout(&self, id: &str, offset: usize) -> Result<Vec<String>, ProcessError>;

    /// The stderr lines the process has printed, redacted, oldest first, from
    /// `offset` on.
    ///
    /// Redaction happens when the line is captured, so the ring never held the
    /// material a server printed and a caller cannot read it back by asking
    /// again. The same offset rule as [`ProcessManager::read_stdout`] applies.
    async fn read_stderr(&self, id: &str, offset: usize) -> Result<Vec<String>, ProcessError>;

    /// Kill and reap every child that is still alive, and report how many there were.
    ///
    /// This is the daemon's exit path: a child of the daemon outlives it unless
    /// something names it, and `Drop` cannot await an OS child. Each kill is
    /// followed by a wait, so a child is reaped rather than left as a zombie.
    async fn kill_all(&self) -> usize;

    /// Write bytes to the process's stdin.
    ///
    /// The MCP stdio transport frames a request with this. A manager that does
    /// not pipe stdin keeps the default, which refuses instead of pretending the
    /// bytes were delivered.
    async fn write_stdin(&self, id: &str, bytes: &[u8]) -> Result<(), ProcessError> {
        let _ = (id, bytes);
        Err(ProcessError::StdInUnsupported(id.to_string()))
    }
}

/// One managed process plus what a restart has to replay and what it printed.
///
/// The environment lives here rather than on [`ManagedProcess`] so that record
/// keeps exactly the six documented fields, and the captured stdout lives behind
/// its own lock so a reader never waits on the entry list.
#[derive(Debug)]
struct Entry {
    process: ManagedProcess,
    env: HashMap<String, String>,
    output: Arc<Mutex<VecDeque<String>>>,
    errors: Arc<Mutex<VecDeque<String>>>,
    /// The child's stdin behind its own lock, so a blocked writer never holds the
    /// entry list (review finding: `write_stdin` held `entries` across the write).
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
}

/// The [`Command`] every spawn and restart builds.
///
/// stdin and stdout are pipes the manager owns: stdin is the MCP transport's
/// frame sink, and stdout is captured ([`ProcessManager::read_stdout`]) so a
/// reply can be read and a printed URL can be found. stderr is piped as well and
/// captured *redacted* ([`ProcessManager::read_stderr`]), so a program's
/// diagnostics still reach the daemon's console without carrying a credential
/// a caller could read back (KEEL K5a).
///
/// The environment is built, not inherited: `env_clear()` first, then the fixed
/// [`MINIMAL_CHILD_ENV`] floor, then the caller's named variables except the
/// loader hooks in [`DENIED_CHILD_ENV_KEYS`]. A variable already in the floor
/// (`PATH`) cannot be replaced.
fn command_for(program: &str, args: &[String], env: &HashMap<String, String>) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    command.env_clear();
    for (key, value) in MINIMAL_CHILD_ENV {
        command.env(key, value);
    }
    // The trusted daemon PATH carries the allow-listed toolchains (`~/.cargo/bin`,
    // nvm, volta). PATH is not a secret; a caller-supplied PATH stays denied by
    // `DENIED_CHILD_ENV_KEYS` below (KEEL K5 review, finding 5).
    command.env("PATH", child_path());
    for (key, value) in env {
        let upper = key.trim().to_ascii_uppercase();
        if DENIED_CHILD_ENV_KEYS.contains(&upper.as_str()) || upper.starts_with("DYLD_") {
            continue;
        }
        command.env(key, value);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

/// Capture `stdout` into `output`, one line at a time, until the pipe closes.
///
/// Each line is also re-emitted as a `tracing` event: stdout used to be
/// inherited, so this is where a dev server's log still reaches the daemon's
/// console now that the manager holds the pipe.
fn capture_stdout(
    id: String,
    stdout: ChildStdout,
    output: Arc<Mutex<VecDeque<String>>>,
    mask_values: Vec<String>,
) {
    capture_lines(id, stdout, output, false, mask_values);
}

/// Capture `stderr` into `errors`, redacted, until the pipe closes.
///
/// Redaction happens before the line is stored or logged: the shape-based
/// [`crate::guardrails::mask_secrets`] pass runs first, then every known value
/// the child received through its environment is replaced with `***`. Neither
/// the ring a test reads nor the daemon's console can carry a token the server
/// printed (KEEL K5a and K5 repair finding 2).
fn capture_stderr(
    id: String,
    stderr: ChildStderr,
    errors: Arc<Mutex<VecDeque<String>>>,
    mask_values: Vec<String>,
) {
    capture_lines(id, stderr, errors, true, mask_values);
}

/// Drain one piped stream into its bounded ring, redacting when asked.
fn capture_lines<R>(
    id: String,
    reader: R,
    sink: Arc<Mutex<VecDeque<String>>>,
    redact: bool,
    mask_values: Vec<String>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        drain_bounded(&id, reader, &sink, redact, &mask_values).await;
    });
}

/// The known secret values a child received through its environment.
///
/// The values come from the environment the caller handed the child (for a
/// plugin, the resolved keychain references), so they are exactly the material
/// that must never come back through `read_stderr` or the daemon log. Very short
/// values are skipped: masking them would mangle diagnostics without protecting
/// a credential.
fn mask_values_for(env: &HashMap<String, String>) -> Vec<String> {
    let mut values: Vec<String> = env
        .values()
        .map(|value| value.trim().to_string())
        .filter(|value| value.len() >= MIN_MASKED_ENV_VALUE_BYTES)
        .collect();
    values.sort();
    values.dedup();
    values
}

/// Append `segment` to `line`, stopping at [`MAX_CAPTURED_LINE_BYTES`].
fn append_bounded(line: &mut Vec<u8>, segment: &[u8], truncated: &mut bool) {
    if line.len() >= MAX_CAPTURED_LINE_BYTES {
        *truncated = true;
        return;
    }
    let room = MAX_CAPTURED_LINE_BYTES - line.len();
    if segment.len() <= room {
        line.extend_from_slice(segment);
    } else {
        line.extend_from_slice(&segment[..room]);
        *truncated = true;
    }
}

/// Store one captured line, enforcing the line-count and byte caps of the ring.
async fn push_captured(
    sink: &Arc<Mutex<VecDeque<String>>>,
    text: String,
    total_bytes: &mut usize,
    max_ring_bytes: usize,
) {
    let mut captured = sink.lock().await;
    *total_bytes += text.len();
    captured.push_back(text);
    while *total_bytes > max_ring_bytes || captured.len() > MAX_CAPTURED_LINES {
        let Some(dropped) = captured.pop_front() else {
            break;
        };
        *total_bytes = total_bytes.saturating_sub(dropped.len());
    }
}

/// Finish `line`: redact, log and store it, then clear the accumulator.
#[allow(clippy::too_many_arguments)]
async fn emit_line(
    id: &str,
    sink: &Arc<Mutex<VecDeque<String>>>,
    line: &mut Vec<u8>,
    truncated: &mut bool,
    redact: bool,
    mask_values: &[String],
    total_bytes: &mut usize,
    max_ring_bytes: usize,
) {
    if line.is_empty() && !*truncated {
        return;
    }
    let mut text = String::from_utf8_lossy(line).into_owned();
    if *truncated {
        text.push_str(TRUNCATION_MARKER);
    }
    if redact {
        text = crate::guardrails::mask_secrets(&text);
        for value in mask_values {
            if !value.is_empty() {
                text = text.replace(value, "***");
            }
        }
        tracing::warn!(process = %id, "{text}");
    } else {
        // The ring keeps the raw protocol bytes because an MCP reply has to parse;
        // the daemon log, however, must not carry a known secret a server printed on
        // stdout. The ring remains owner-readable as before (tracked residual).
        let mut logged = text.clone();
        for value in mask_values {
            if !value.is_empty() {
                logged = logged.replace(value, "***");
            }
        }
        tracing::info!(process = %id, "{logged}");
    }
    line.clear();
    *truncated = false;
    push_captured(sink, text, total_bytes, max_ring_bytes).await;
}

/// Read `reader` into `sink` with a per-line byte cap and a total ring byte cap.
///
/// This replaces `BufReader::lines()`, which built a whole line before masking:
/// a single 2 MiB stderr line without a newline could grow the daemon's memory
/// without bound (KEEL K5 review, finding 4). A line that reaches the cap is
/// flushed immediately, so a no-newline stream stays bounded too.
pub(crate) async fn drain_bounded<R>(
    id: &str,
    reader: R,
    sink: &Arc<Mutex<VecDeque<String>>>,
    redact: bool,
    mask_values: &[String],
) where
    R: AsyncRead + Unpin,
{
    let mut reader = reader;
    let mut chunk = [0u8; 8192];
    let mut line: Vec<u8> = Vec::new();
    let mut truncated = false;
    let mut total_bytes = 0usize;
    let max_ring_bytes = if redact {
        MAX_CAPTURED_STDERR_BYTES
    } else {
        MAX_CAPTURED_LINE_BYTES * MAX_CAPTURED_LINES
    };
    loop {
        let n = match tokio::io::AsyncReadExt::read(&mut reader, &mut chunk).await {
            Ok(0) => break,
            Ok(n) => n,
            // A closed pipe and a broken read are both the end of the transcript;
            // the exit status is what says how the child ended.
            Err(_) => break,
        };
        let mut start = 0usize;
        for i in 0..n {
            if chunk[i] == b'\n' {
                append_bounded(&mut line, &chunk[start..i], &mut truncated);
                emit_line(
                    id,
                    sink,
                    &mut line,
                    &mut truncated,
                    redact,
                    mask_values,
                    &mut total_bytes,
                    max_ring_bytes,
                )
                .await;
                start = i + 1;
            }
        }
        append_bounded(&mut line, &chunk[start..n], &mut truncated);
        if line.len() >= MAX_CAPTURED_LINE_BYTES {
            // The line was cut at the cap and continues in the next segment; the
            // marker is what tells a reader the text is not the whole line.
            truncated = true;
            emit_line(
                id,
                sink,
                &mut line,
                &mut truncated,
                redact,
                mask_values,
                &mut total_bytes,
                max_ring_bytes,
            )
            .await;
        }
    }
    emit_line(
        id,
        sink,
        &mut line,
        &mut truncated,
        redact,
        mask_values,
        &mut total_bytes,
        max_ring_bytes,
    )
    .await;
}

/// Observe `process` once: settle a finished child, promote a live `Starting`.
///
/// Returns the inspection error after recording [`ProcessStatus::Failed`], so a
/// caller that has no error channel still sees the outcome in the record.
fn refresh(process: &mut ManagedProcess) -> Result<(), ProcessError> {
    let Some(child) = process.child.as_mut() else {
        return Ok(());
    };
    let observed = child.try_wait();
    match observed {
        Ok(Some(exit)) => {
            process.exit_code = exit.code();
            process.status = if exit.success() {
                ProcessStatus::Stopped
            } else {
                ProcessStatus::Crashed
            };
            process.child = None;
            Ok(())
        }
        Ok(None) => {
            if process.status == ProcessStatus::Starting {
                process.status = ProcessStatus::Running;
            }
            Ok(())
        }
        Err(source) => {
            process.status = ProcessStatus::Failed;
            Err(ProcessError::Inspect {
                id: process.id.clone(),
                source,
            })
        }
    }
}

/// A [`ProcessManager`] that keeps its processes in memory.
///
/// This is the manager the daemon runs: ids are a counter (`proc-1`, `proc-2`, …)
/// so a test can predict them, and the child handles live behind one `Mutex` that
/// is never held across a user-supplied await.
#[derive(Debug)]
pub struct InMemoryProcessManager {
    entries: Mutex<Vec<Entry>>,
    next_id: AtomicU64,
    /// The policy a [`ProcessManager::restart`] re-checks before it re-spawns.
    ///
    /// It is set at construction and never absent: a manager always judges a
    /// restart against *some* policy, so no caller can build one that skips the
    /// check (KEEL checkpoint finding M4).
    policy: Arc<CommandPolicy>,
}

impl Default for InMemoryProcessManager {
    fn default() -> Self {
        InMemoryProcessManager::new()
    }
}

impl InMemoryProcessManager {
    /// An empty manager that re-checks `restart` against the shipped safe list.
    ///
    /// An unset configuration means `DEFAULT_ALLOWED_COMMANDS`, the same rule
    /// [`CommandPolicy::from_config`] applies, so a manager built with no explicit
    /// policy is never unrestricted.
    pub fn new() -> Self {
        InMemoryProcessManager::with_policy(CommandPolicy::from_config(&[]))
    }

    /// An empty manager that re-checks `restart` against `policy`.
    pub fn with_policy(policy: CommandPolicy) -> Self {
        InMemoryProcessManager {
            entries: Mutex::new(Vec::new()),
            next_id: AtomicU64::new(1),
            policy: Arc::new(policy),
        }
    }

    /// The manager as the daemon holds it, so one instance is shared by the
    /// process RPC, the MCP transports and the live preview.
    pub fn shared() -> Arc<dyn ProcessManager> {
        Arc::new(InMemoryProcessManager::new())
    }

    /// The daemon's own manager: one instance, re-checking a restart against the
    /// owner's configured allow-list.
    pub fn shared_with_policy(policy: CommandPolicy) -> Arc<dyn ProcessManager> {
        Arc::new(InMemoryProcessManager::with_policy(policy))
    }
}

#[async_trait]
impl ProcessManager for InMemoryProcessManager {
    async fn spawn(
        &self,
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<String, ProcessError> {
        let program = command.trim();
        if program.is_empty() {
            return Err(ProcessError::EmptyCommand);
        }
        let mut child =
            command_for(program, args, env)
                .spawn()
                .map_err(|source| ProcessError::Spawn {
                    command: program.to_string(),
                    source,
                })?;
        let id = format!("proc-{}", self.next_id.fetch_add(1, Ordering::SeqCst));
        // The pipe goes to its own task before the child is recorded, so the
        // first line a caller reads cannot be lost to a late reader.
        let output = Arc::new(Mutex::new(VecDeque::new()));
        if let Some(stdout) = child.stdout.take() {
            capture_stdout(id.clone(), stdout, output.clone(), mask_values_for(env));
        }
        let errors = Arc::new(Mutex::new(VecDeque::new()));
        if let Some(stderr) = child.stderr.take() {
            capture_stderr(id.clone(), stderr, errors.clone(), mask_values_for(env));
        }
        let stdin = child.stdin.take();
        let entry = Entry {
            process: ManagedProcess {
                id: id.clone(),
                command: program.to_string(),
                args: args.to_vec(),
                child: Some(child),
                status: ProcessStatus::Starting,
                started_at: Some(now_epoch_secs()),
                exit_code: None,
            },
            env: env.clone(),
            output,
            errors,
            stdin: Arc::new(Mutex::new(stdin)),
        };
        self.entries.lock().await.push(entry);
        Ok(id)
    }

    async fn stop(&self, id: &str) -> Result<(), ProcessError> {
        let mut entries = self.entries.lock().await;
        let entry = entries
            .iter_mut()
            .find(|entry| entry.process.id == id)
            .ok_or_else(|| ProcessError::NotFound(id.to_string()))?;
        refresh(&mut entry.process)?;
        let Some(mut child) = entry.process.child.take() else {
            return Err(ProcessError::NotRunning(id.to_string()));
        };
        if let Err(source) = child.kill().await {
            // The handle goes back, so a kill that failed leaves the process
            // stoppable instead of parked as running with nothing to signal.
            entry.process.child = Some(child);
            return Err(ProcessError::Stop {
                id: id.to_string(),
                source,
            });
        }
        // The child is reaped by `kill`; a signalled child has no exit code on
        // Unix, so this stays `None` there and the status is what says it stopped.
        entry.process.exit_code = child.try_wait().ok().flatten().and_then(|exit| exit.code());
        entry.process.status = ProcessStatus::Stopped;
        Ok(())
    }

    async fn status(&self, id: &str) -> Result<ProcessStatus, ProcessError> {
        let mut entries = self.entries.lock().await;
        let entry = entries
            .iter_mut()
            .find(|entry| entry.process.id == id)
            .ok_or_else(|| ProcessError::NotFound(id.to_string()))?;
        refresh(&mut entry.process)?;
        Ok(entry.process.status)
    }

    async fn list(&self) -> Vec<ManagedProcess> {
        let mut entries = self.entries.lock().await;
        for entry in entries.iter_mut() {
            // `list` has no error channel; a failed inspection has already parked
            // the record as `Failed`, which is what the caller needs to see.
            let _ = refresh(&mut entry.process);
        }
        entries
            .iter()
            .map(|entry| entry.process.detached())
            .collect()
    }

    async fn restart(&self, id: &str) -> Result<String, ProcessError> {
        let mut entries = self.entries.lock().await;
        let entry = entries
            .iter_mut()
            .find(|entry| entry.process.id == id)
            .ok_or_else(|| ProcessError::NotFound(id.to_string()))?;

        // The program and its arguments are judged again before the running child
        // is touched: a policy narrowed after the spawn refuses here, and the
        // process keeps running rather than being killed into a refused restart.
        self.policy
            .check_invocation(&entry.process.command, &entry.process.args)
            .map_err(|error| ProcessError::PolicyRefused {
                id: entry.process.id.clone(),
                reason: error.to_string(),
            })?;

        if let Some(mut child) = entry.process.child.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }

        let mut child = command_for(&entry.process.command, &entry.process.args, &entry.env)
            .spawn()
            .map_err(|source| ProcessError::Spawn {
                command: entry.process.command.clone(),
                source,
            })?;
        // The transcript belongs to the process, not to the run: the new server's
        // banner is read from an empty log, because leaving the old lines behind
        // would let a preview report the URL of the server it replaced.
        entry.output = Arc::new(Mutex::new(VecDeque::new()));
        entry.errors = Arc::new(Mutex::new(VecDeque::new()));
        if let Some(stdout) = child.stdout.take() {
            capture_stdout(
                entry.process.id.clone(),
                stdout,
                entry.output.clone(),
                mask_values_for(&entry.env),
            );
        }
        if let Some(stderr) = child.stderr.take() {
            capture_stderr(
                entry.process.id.clone(),
                stderr,
                entry.errors.clone(),
                mask_values_for(&entry.env),
            );
        }
        // The restarted child gets a fresh stdin handle; a writer still holding
        // the old one writes to the dead child instead of the entry list.
        entry.stdin = Arc::new(Mutex::new(child.stdin.take()));
        entry.process.child = Some(child);
        entry.process.status = ProcessStatus::Starting;
        entry.process.started_at = Some(now_epoch_secs());
        entry.process.exit_code = None;
        Ok(entry.process.id.clone())
    }

    async fn read_stdout(&self, id: &str, offset: usize) -> Result<Vec<String>, ProcessError> {
        let entries = self.entries.lock().await;
        let entry = entries
            .iter()
            .find(|entry| entry.process.id == id)
            .ok_or_else(|| ProcessError::NotFound(id.to_string()))?;
        let captured = entry.output.lock().await;
        Ok(captured.iter().skip(offset).cloned().collect())
    }

    async fn read_stderr(&self, id: &str, offset: usize) -> Result<Vec<String>, ProcessError> {
        let entries = self.entries.lock().await;
        let entry = entries
            .iter()
            .find(|entry| entry.process.id == id)
            .ok_or_else(|| ProcessError::NotFound(id.to_string()))?;
        let captured = entry.errors.lock().await;
        Ok(captured.iter().skip(offset).cloned().collect())
    }

    async fn kill_all(&self) -> usize {
        let mut entries = self.entries.lock().await;
        let mut killed = 0;
        for entry in entries.iter_mut() {
            // A child that already exited has nothing to signal, so the sweep
            // settles it and moves on rather than reporting it as killed.
            let _ = refresh(&mut entry.process);
            let Some(mut child) = entry.process.child.take() else {
                continue;
            };
            let _ = child.start_kill();
            match child.wait().await {
                Ok(exit) => {
                    entry.process.exit_code = exit.code();
                    entry.process.status = ProcessStatus::Stopped;
                }
                Err(_) => entry.process.status = ProcessStatus::Failed,
            }
            killed += 1;
        }
        killed
    }

    async fn write_stdin(&self, id: &str, bytes: &[u8]) -> Result<(), ProcessError> {
        // Clone the per-entry stdin handle under the entry lock, then release it:
        // a child that stops reading must not wedge `status`, `list`, `stop` or
        // `kill_all` while its peer-controlled pipe is full.
        let stdin = {
            let entries = self.entries.lock().await;
            entries
                .iter()
                .find(|entry| entry.process.id == id)
                .map(|entry| entry.stdin.clone())
                .ok_or_else(|| ProcessError::NotFound(id.to_string()))?
        };
        let mut guard = stdin.lock().await;
        let Some(stdin) = guard.as_mut() else {
            return Err(ProcessError::StdInUnsupported(id.to_string()));
        };
        let write = async {
            stdin.write_all(bytes).await?;
            stdin.flush().await
        };
        match tokio::time::timeout(STDIN_WRITE_TIMEOUT, write).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(source)) => Err(ProcessError::Write {
                id: id.to_string(),
                source,
            }),
            Err(_) => Err(ProcessError::StdinTimeout(id.to_string())),
        }
    }
}

/// Split `"npm run dev"` into the program and its arguments.
///
/// Whitespace separates arguments, with no shell and no expansion. Quoting is
/// honoured so a program or argument that contains a space survives as one
/// token: `'…'` is literal, `"…"` groups with `\"` and `\\` escapes, and
/// adjacent quoted/unquoted parts join (`a"b c"d` is the single token `ab cd`).
/// An unterminated quote is [`ProcessError::UnterminatedQuote`]; empty or
/// whitespace-only input is [`ProcessError::EmptyCommand`].
pub fn split_command(command: &str) -> Result<(String, Vec<String>), ProcessError> {
    LivePreviewManager::split_command(command)
}

/// One project's dev server, as the preview panel reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LivePreview {
    /// The project the server belongs to.
    pub project_id: String,
    /// The managed process behind it.
    pub process_id: String,
    /// The program that was started.
    pub command: String,
    /// Its arguments.
    pub args: Vec<String>,
    /// The process status, observed rather than remembered.
    pub status: ProcessStatus,
    /// The URL the server printed, or `None` when it printed none in time.
    ///
    /// A dev server picks its own port, so the address is read from what the
    /// server printed rather than guessed: a wrong URL in the panel is worse than
    /// an empty one, and `status` re-reads the transcript, so a late banner still
    /// arrives.
    pub url: Option<String>,
}

/// The first URL in `lines`, or `None` when none of them carries one.
///
/// A dev server announces itself with a line like
/// `  ➜  Local:   http://localhost:5173/`, so this returns the first URL in the
/// transcript exactly as printed — no normalisation and no port guessing, because
/// the address the server printed is the address that answers. The first one wins
/// because a banner lists the local address before any other.
pub fn discover_url(lines: &[String]) -> Option<String> {
    lines.iter().find_map(|line| first_url(line))
}

/// The URL inside one line, with the punctuation a banner appended removed.
fn first_url(line: &str) -> Option<String> {
    let (start, scheme) = ["http://", "https://"]
        .iter()
        .filter_map(|scheme| line.find(scheme).map(|at| (at, *scheme)))
        .min_by_key(|(at, _)| *at)?;
    let candidate = &line[start..];
    let end = candidate
        .find(|character: char| character.is_whitespace() || "\"'`<>=|,*)]}".contains(character))
        .unwrap_or(candidate.len());
    let url = candidate[..end].trim_end_matches(['.', ',', ';', ':', ')', ']', '}', '"', '\'']);
    // A scheme with nothing after it names no host, so it is not a URL.
    if url.len() <= scheme.len() {
        return None;
    }
    Some(url.to_string())
}

/// The preview's record of one project, without its status.
#[derive(Debug, Clone)]
struct PreviewEntry {
    process_id: String,
    command: String,
    args: Vec<String>,
    /// The run that owns this server, or `None` for one started outside a run.
    ///
    /// Ownership metadata, not a second key (R-BRIDGE-B5 D1): the project is still
    /// what a lookup is by, and this answers *whose* server it is — which is what
    /// lets a run's end stop it and stops a newcomer inheriting it.
    run_id: Option<String>,
}

/// Whether a run is still live, which is what makes a preview's owner dead or alive.
///
/// `process_spawn` owns processes, not run records, so the answer is handed in
/// rather than reached for: the daemon implements this over the store it already
/// reads. A manager built without one ([`LivePreviewManager::new`]) cannot prove an
/// owner dead, so it treats every owner as live and never lets a newcomer take a
/// tagged server (the no-steal rule, fail-closed).
#[async_trait]
pub trait RunLiveness: Send + Sync {
    /// `true` when `run_id` names a run that has not finished.
    async fn is_live(&self, run_id: &str) -> bool;
}

/// Starts and stops one dev server per project through a [`ProcessManager`].
///
/// The URL of a running dev server is not configured, it is *read*: the server
/// chooses its own port and prints it, and [`LivePreviewManager::start`] waits up
/// to [`PREVIEW_URL_TIMEOUT`] for a line carrying one. A server that prints
/// nothing in that time leaves `url` as `None` — the panel shows no address
/// rather than a wrong one — while [`LivePreviewManager::status`] and
/// [`LivePreviewManager::list`] look again at the transcript, so a server that
/// prints its banner late still reports its address.
pub struct LivePreviewManager {
    processes: Arc<dyn ProcessManager>,
    previews: Mutex<Vec<(String, PreviewEntry)>>,
    /// How an owner run's liveness is judged (R-BRIDGE-B5 D3); `None` on a manager
    /// with no run source, where an owner is therefore treated as live.
    run_liveness: Option<Arc<dyn RunLiveness>>,
}

impl LivePreviewManager {
    /// A manager over the one [`ProcessManager`] the daemon owns.
    pub fn new(processes: Arc<dyn ProcessManager>) -> Self {
        LivePreviewManager {
            processes,
            previews: Mutex::new(Vec::new()),
            run_liveness: None,
        }
    }

    /// The same manager, judging an owner run's liveness through `run_liveness`.
    ///
    /// A preview records the run that started it and a run's end stops it; the
    /// oracle is what tells a live owner from one that died without its close ever
    /// running, so the dead one's entry is swept rather than blocking the next run
    /// (R-BRIDGE-B5 D2, D3).
    pub fn with_run_liveness(mut self, run_liveness: Arc<dyn RunLiveness>) -> Self {
        self.run_liveness = Some(run_liveness);
        self
    }

    /// Split `"npm run dev"` into the program and its arguments.
    ///
    /// Whitespace separates arguments, with no shell and no expansion. Quoting is
    /// honoured so a program or argument that contains a space survives as one
    /// token: `'…'` is literal, `"…"` groups with `\"` and `\\` escapes, and
    /// adjacent quoted/unquoted parts join (`a"b c"d` is the single token `ab cd`).
    /// An unterminated quote is [`ProcessError::UnterminatedQuote`]; empty or
    /// whitespace-only input is [`ProcessError::EmptyCommand`].
    pub fn split_command(command: &str) -> Result<(String, Vec<String>), ProcessError> {
        let mut tokens = Self::split_quoted(command)?.into_iter();
        let program = tokens.next().ok_or(ProcessError::EmptyCommand)?;
        Ok((program, tokens.collect()))
    }

    /// Tokenize a command line, honouring single and double quotes.
    ///
    /// Returns every argument in order; an empty or whitespace-only line yields no
    /// tokens. Only an unclosed quote is an error here — the "no program" case is
    /// left to [`LivePreviewManager::split_command`]. A backslash is an escape only
    /// inside double quotes and only before `"` or `\`; elsewhere (including before
    /// any other character in a Windows path) it is literal.
    fn split_quoted(command: &str) -> Result<Vec<String>, ProcessError> {
        let mut tokens = Vec::new();
        let mut current = String::new();
        // An empty quoted string (`""`) is a real, empty token; this flag tells a
        // started token apart from no token at all.
        let mut in_token = false;
        let mut chars = command.chars().peekable();

        while let Some(ch) = chars.next() {
            if ch.is_whitespace() {
                if in_token {
                    tokens.push(std::mem::take(&mut current));
                    in_token = false;
                }
                continue;
            }
            in_token = true;
            match ch {
                '\'' => loop {
                    match chars.next() {
                        Some('\'') => break,
                        Some(literal) => current.push(literal),
                        None => return Err(ProcessError::UnterminatedQuote { quote: '\'' }),
                    }
                },
                '"' => loop {
                    match chars.next() {
                        Some('"') => break,
                        Some('\\') => match chars.peek().copied() {
                            Some('"') | Some('\\') => {
                                if let Some(escaped) = chars.next() {
                                    current.push(escaped);
                                }
                            }
                            _ => current.push('\\'),
                        },
                        Some(literal) => current.push(literal),
                        None => return Err(ProcessError::UnterminatedQuote { quote: '"' }),
                    }
                },
                literal => current.push(literal),
            }
        }
        if in_token {
            tokens.push(current);
        }
        Ok(tokens)
    }

    /// Start `command` as `project_id`'s dev server, owned by `run_id` when given.
    ///
    /// One preview per project: a second start is refused while the first is
    /// alive, because two servers on one port is a port conflict, not a feature.
    /// A preview whose process has finished may be replaced.
    ///
    /// The run id is ownership, not a second key (R-BRIDGE-B5 D1): `preview.start`
    /// still addresses a project, and the id answers whose server it is, so the
    /// run's end can stop it ([`LivePreviewManager::stop_run`]). A start with a run
    /// id on a project whose live server belongs to another live run is refused
    /// with [`ProcessError::PreviewOwnedByRun`] (D3); a server whose owner has
    /// finished never blocks, because the dead entry is swept before this check.
    ///
    /// The call waits up to [`PREVIEW_URL_TIMEOUT`] for the server to print its
    /// address, so the preview the caller gets back already carries the URL when
    /// the server announces itself — which every real dev server does.
    pub async fn start(
        &self,
        project_id: &str,
        command: &str,
        run_id: Option<&str>,
    ) -> Result<LivePreview, ProcessError> {
        let project = project_id.trim();
        if project.is_empty() {
            return Err(ProcessError::EmptyProjectId);
        }
        // A caller that names no run owns nothing: an empty id is no id, so a
        // server started with it stays the project's ambient one.
        let run_id = run_id
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string);

        // A dead run's entry never blocks a newcomer, so it is swept before the
        // ownership check rather than after it (D3).
        self.sweep_dead(project).await;

        if let Ok(entry) = self.preview_entry(project).await {
            // A process the manager no longer has counts as finished, so its
            // project may start a new preview instead of being stuck forever.
            let status = self
                .processes
                .status(&entry.process_id)
                .await
                .unwrap_or(ProcessStatus::Stopped);
            if !status.is_terminal() {
                return Err(match (entry.run_id.as_deref(), run_id.as_deref()) {
                    // The server is another live run's to keep: this is ownership,
                    // not a port conflict, and the answer says so.
                    (Some(owner), Some(caller)) if owner != caller => {
                        ProcessError::PreviewOwnedByRun {
                            project: project.to_string(),
                            owner: owner.to_string(),
                            run_id: caller.to_string(),
                        }
                    }
                    // The same run asking twice, or a server no run owns, is the
                    // one-preview-per-project rule.
                    _ => ProcessError::PreviewAlreadyRunning(project.to_string()),
                });
            }
        }

        let (program, args) = LivePreviewManager::split_command(command)?;
        let process_id = self
            .processes
            .spawn(&program, &args, &HashMap::new())
            .await?;

        {
            // The guard is scoped so the URL wait below does not hold the list:
            // `status` and `list` have to keep answering while a server starts.
            let mut previews = self.previews.lock().await;
            previews.retain(|(id, _)| id != project);
            previews.push((
                project.to_string(),
                PreviewEntry {
                    process_id: process_id.clone(),
                    command: program.clone(),
                    args: args.clone(),
                    run_id,
                },
            ));
        }

        let url = self.wait_for_url(&process_id, PREVIEW_URL_TIMEOUT).await;
        Ok(LivePreview {
            project_id: project.to_string(),
            process_id,
            command: program,
            args,
            status: ProcessStatus::Starting,
            url,
        })
    }

    /// Stop `project_id`'s dev server.
    ///
    /// Stopping a preview whose server already exited succeeds: the caller asked
    /// for it to be down, and it is.
    pub async fn stop(&self, project_id: &str) -> Result<(), ProcessError> {
        let project = project_id.trim();
        let entry = self.preview_entry(project).await?;
        match self.processes.stop(&entry.process_id).await {
            Ok(()) | Err(ProcessError::NotRunning(_)) | Err(ProcessError::NotFound(_)) => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// Stop and drop every dev server `run_id` owns, answering how many there were.
    ///
    /// This is what a run's end calls — the terminal `runs.advance` arm and
    /// `runs.cancel` — so the server a run started dies with it (R-BRIDGE-B5 D2).
    ///
    /// Best-effort by construction: it returns no error, so no run close can fail
    /// because a dev server would not die. A stop that fails is logged and the
    /// entry is dropped anyway — the run is over either way, and a preview entry
    /// nobody will ever stop is worse than a child the daemon's exit reaps.
    pub async fn stop_run(&self, run_id: &str) -> usize {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return 0;
        }

        // The entries leave the list before any child is touched: a stop awaits
        // the OS, and `status`/`list` have to keep answering meanwhile.
        let owned: Vec<(String, String)> = {
            let mut previews = self.previews.lock().await;
            let mut kept = Vec::with_capacity(previews.len());
            let mut owned = Vec::new();
            for (project, entry) in previews.drain(..) {
                match entry.run_id.as_deref() {
                    Some(owner) if owner == run_id => owned.push((project, entry.process_id)),
                    _ => kept.push((project, entry)),
                }
            }
            *previews = kept;
            owned
        };

        for (project, process_id) in &owned {
            match self.processes.stop(process_id).await {
                Ok(()) | Err(ProcessError::NotRunning(_) | ProcessError::NotFound(_)) => {}
                Err(error) => {
                    tracing::warn!(
                        project = %project,
                        run_id = %run_id,
                        process_id = %process_id,
                        "the preview of a finished run could not be stopped: {error}"
                    );
                }
            }
        }
        owned.len()
    }

    /// The current status of `project_id`'s dev server.
    ///
    /// In a run context (`run_id` is `Some`) the answer is that run's server: a
    /// preview the store still tracks for the project but another run owns is not
    /// this run's, so it is `PreviewNotFound` for this caller (R-BRIDGE-B5 D4).
    /// Without a run context the project's server is the answer, which keeps a
    /// project-scoped status call working.
    pub async fn status(
        &self,
        project_id: &str,
        run_id: Option<&str>,
    ) -> Result<LivePreview, ProcessError> {
        let project = project_id.trim();
        // A run that died without its close running must not answer a stale
        // preview, so the same lazy sweep `start` performs runs here too (D3).
        self.sweep_dead(project).await;
        let entry = self.preview_entry(project).await?;
        if let Some(caller) = run_id.map(str::trim).filter(|id| !id.is_empty()) {
            if matches!(entry.run_id.as_deref(), Some(owner) if owner != caller) {
                return Err(ProcessError::PreviewNotFound(project.to_string()));
            }
        }
        let status = self
            .processes
            .status(&entry.process_id)
            .await
            .unwrap_or(ProcessStatus::Stopped);
        let url = self.printed_url(&entry.process_id).await;
        Ok(LivePreview {
            project_id: project.to_string(),
            process_id: entry.process_id,
            command: entry.command,
            args: entry.args,
            status,
            url,
        })
    }

    /// Every preview, in the order its project first started one.
    pub async fn list(&self) -> Vec<LivePreview> {
        let entries: Vec<(String, PreviewEntry)> = self.previews.lock().await.clone();
        let mut previews = Vec::with_capacity(entries.len());
        for (project_id, entry) in entries {
            let status = self
                .processes
                .status(&entry.process_id)
                .await
                .unwrap_or(ProcessStatus::Stopped);
            let url = self.printed_url(&entry.process_id).await;
            previews.push(LivePreview {
                project_id,
                process_id: entry.process_id,
                command: entry.command,
                args: entry.args,
                status,
                url,
            });
        }
        previews
    }

    /// The stored entry for a project, or `PreviewNotFound`.
    async fn preview_entry(&self, project_id: &str) -> Result<PreviewEntry, ProcessError> {
        self.previews
            .lock()
            .await
            .iter()
            .find(|(id, _)| id == project_id)
            .map(|(_, entry)| entry.clone())
            .ok_or_else(|| ProcessError::PreviewNotFound(project_id.to_string()))
    }

    /// Drop, and stop, every entry for `project_id` whose owner run has finished.
    ///
    /// This is the lazy half of R-BRIDGE-B5 D3: a run that ends by its close is
    /// stopped there, but a run that died without one leaves its server behind, and
    /// that stale entry must not block the next run of the project. The owners are
    /// judged outside the list lock — a liveness answer reads a store — and each
    /// doomed entry is re-found by its process id before it is removed, so a
    /// concurrent `stop_run` that already dropped it is not double-counted.
    ///
    /// Returns how many entries were swept.
    async fn sweep_dead(&self, project_id: &str) -> usize {
        let owned: Vec<(String, String)> = self
            .previews
            .lock()
            .await
            .iter()
            .filter(|(id, entry)| id == project_id && entry.run_id.is_some())
            .filter_map(|(_, entry)| {
                entry
                    .run_id
                    .as_ref()
                    .map(|run_id| (entry.process_id.clone(), run_id.clone()))
            })
            .collect();

        let mut dead: Vec<(String, String)> = Vec::new();
        for (process_id, run_id) in owned {
            if !self.run_is_live(&run_id).await {
                dead.push((process_id, run_id));
            }
        }
        if dead.is_empty() {
            return 0;
        }

        let mut swept: Vec<String> = Vec::new();
        {
            let mut previews = self.previews.lock().await;
            for (process_id, run_id) in &dead {
                let before = previews.len();
                previews.retain(|(id, entry)| {
                    !(id == project_id
                        && entry.process_id == *process_id
                        && entry.run_id.as_deref() == Some(run_id.as_str()))
                });
                if previews.len() < before {
                    swept.push(process_id.clone());
                }
            }
        }

        for process_id in &swept {
            match self.processes.stop(process_id).await {
                Ok(()) | Err(ProcessError::NotRunning(_) | ProcessError::NotFound(_)) => {}
                Err(error) => {
                    tracing::warn!(
                        project = %project_id,
                        process_id = %process_id,
                        "the preview of a run that is no longer live could not be stopped: {error}"
                    );
                }
            }
        }
        swept.len()
    }

    /// Whether an entry's owner run is still live.
    ///
    /// A manager with no run source cannot prove an owner dead, so it answers `true`
    /// and keeps the no-steal rule: refusing a newcomer is recoverable with
    /// `preview.stop`, while stealing a live server is not.
    async fn run_is_live(&self, run_id: &str) -> bool {
        match self.run_liveness {
            Some(ref liveness) => liveness.is_live(run_id).await,
            None => true,
        }
    }

    /// The first URL a process has printed, waiting up to `timeout` for one.
    ///
    /// The wait is bounded and it is the only one: a server that never prints an
    /// address costs this call its timeout once, and every later read answers
    /// from the transcript as it stands.
    async fn wait_for_url(&self, process_id: &str, timeout: Duration) -> Option<String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(url) = self.printed_url(process_id).await {
                return Some(url);
            }
            if Instant::now() >= deadline {
                return None;
            }
            tokio::time::sleep(URL_POLL_INTERVAL).await;
        }
    }

    /// The first URL the process has printed so far, without waiting.
    ///
    /// A process the manager no longer tracks has no transcript left to read, and
    /// that is `None` rather than an error: the preview still reports its status.
    async fn printed_url(&self, process_id: &str) -> Option<String> {
        let lines = self.processes.read_stdout(process_id, 0).await.ok()?;
        discover_url(&lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// The address the preview probe prints and the preview test expects.
    ///
    /// The child is this same test binary, so both halves read one constant: a
    /// dev server that printed something else would be a different server.
    const PROBE_URL: &str = "http://127.0.0.1:5199/";

    /// The runs a preview test's manager judges live, and what it can kill.
    ///
    /// The production oracle reads a run store; a preview test needs the same one
    /// answer, set and revoked on demand, so a "the run died" case is a single
    /// call instead of a database write.
    struct LiveRuns(std::sync::Mutex<std::collections::HashSet<String>>);

    impl LiveRuns {
        fn of(runs: &[&str]) -> Arc<Self> {
            Arc::new(LiveRuns(std::sync::Mutex::new(
                runs.iter().map(|id| (*id).to_string()).collect(),
            )))
        }

        /// The run is over — and no close ran, which is the state a sweep finds.
        fn finish(&self, run_id: &str) {
            self.0
                .lock()
                .expect("the live set is not poisoned")
                .remove(run_id);
        }
    }

    #[async_trait]
    impl RunLiveness for LiveRuns {
        async fn is_live(&self, run_id: &str) -> bool {
            self.0
                .lock()
                .expect("the live set is not poisoned")
                .contains(run_id)
        }
    }

    /// A spawner whose `stop` always fails: a dev server that will not die.
    ///
    /// Everything a preview needs — spawn, status, stdout — is the real in-memory
    /// manager's; only the kill is poisoned, and the count proves the close tried.
    struct Unstoppable {
        inner: Arc<dyn ProcessManager>,
        refused: std::sync::atomic::AtomicUsize,
    }

    impl Unstoppable {
        fn new() -> Arc<Self> {
            Arc::new(Unstoppable {
                inner: InMemoryProcessManager::shared(),
                refused: std::sync::atomic::AtomicUsize::new(0),
            })
        }

        fn refusals(&self) -> usize {
            self.refused.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl ProcessManager for Unstoppable {
        async fn spawn(
            &self,
            command: &str,
            args: &[String],
            env: &HashMap<String, String>,
        ) -> Result<String, ProcessError> {
            self.inner.spawn(command, args, env).await
        }

        async fn stop(&self, id: &str) -> Result<(), ProcessError> {
            self.refused
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err(ProcessError::Stop {
                id: id.to_string(),
                source: std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "the server ignored the signal",
                ),
            })
        }

        async fn status(&self, id: &str) -> Result<ProcessStatus, ProcessError> {
            self.inner.status(id).await
        }

        async fn list(&self) -> Vec<ManagedProcess> {
            self.inner.list().await
        }

        async fn restart(&self, id: &str) -> Result<String, ProcessError> {
            self.inner.restart(id).await
        }

        async fn read_stdout(&self, id: &str, offset: usize) -> Result<Vec<String>, ProcessError> {
            self.inner.read_stdout(id, offset).await
        }

        async fn read_stderr(&self, id: &str, offset: usize) -> Result<Vec<String>, ProcessError> {
            self.inner.read_stderr(id, offset).await
        }

        async fn kill_all(&self) -> usize {
            self.inner.kill_all().await
        }
    }

    /// The ignored test the preview tests spawn as their dev server.
    ///
    /// `LivePreviewManager::start` splits a whitespace-only command line and
    /// passes no environment, so the child identifies itself by the arguments it
    /// was started with — `--exact` names this probe — and prints the constant
    /// above rather than anything it has to be told. `--ignored` selects an
    /// ignored test, and `--nocapture` is what lets its `println!` reach the pipe
    /// the manager reads instead of libtest's in-memory buffer.
    ///
    /// The guard makes the probe harmless if a full ignored run ever reaches it:
    /// only a run pointed at `--exact` is a child of a test.
    #[test]
    #[ignore = "a child process, not a test"]
    fn preview_url_probe() {
        if !std::env::args().any(|arg| arg == "--exact") {
            return;
        }
        println!("  ➜  Local:   {PROBE_URL}");
        loop {
            std::thread::park();
        }
    }

    /// The probe's `program args…` as one command line, which is what a preview takes.
    fn probe_line() -> String {
        probe_line_for("process_spawn::tests::preview_url_probe")
    }

    /// The ignored test the preview tests spawn as a dev server that stays up and
    /// prints nothing, which is the case a preview must not invent a URL for.
    #[test]
    #[ignore = "a child process, not a test"]
    fn preview_silent_probe() {
        if !std::env::args().any(|arg| arg == "--exact") {
            return;
        }
        loop {
            std::thread::park();
        }
    }

    /// The command line that spawns one probe of this test binary.
    ///
    /// The executable is quoted so a test binary under a path with spaces survives
    /// [`LivePreviewManager::split_command`]'s quote-aware split.
    fn probe_line_for(test: &str) -> String {
        let exe = std::env::current_exe().expect("the test binary names itself");
        format!("\"{}\" --exact {test} --ignored --nocapture", exe.display())
    }

    /// Poll the manager until the process has printed at least one line.
    async fn wait_for_output(manager: &dyn ProcessManager, id: &str) -> Vec<String> {
        for _ in 0..200 {
            let lines = manager
                .read_stdout(id, 0)
                .await
                .expect("the process is tracked");
            if !lines.is_empty() {
                return lines;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("process `{id}` printed nothing within four seconds");
    }

    /// A command that outlives the test (Windows half): blocks on stdin like `cat`.
    #[cfg(windows)]
    fn long_running() -> (String, Vec<String>) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "more".to_string()],
        )
    }

    /// A command that outlives the test (Unix half).
    #[cfg(not(windows))]
    fn long_running() -> (String, Vec<String>) {
        ("sh".to_string(), vec!["-c".to_string(), "cat".to_string()])
    }

    /// A command that exits immediately with code 0.
    #[cfg(windows)]
    fn immediate_exit() -> (String, Vec<String>) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "exit 0".to_string()],
        )
    }

    /// A command that exits immediately with code 0 (Unix half).
    #[cfg(not(windows))]
    fn immediate_exit() -> (String, Vec<String>) {
        (
            "sh".to_string(),
            vec!["-c".to_string(), "exit 0".to_string()],
        )
    }

    /// A manager whose policy admits the platform shell.
    ///
    /// [`long_running`] is a shell and the shipped default list refuses shells,
    /// so a restart test whose re-check is meant to pass needs a policy that
    /// admits the program the test spawns.
    fn shell_manager() -> InMemoryProcessManager {
        #[cfg(windows)]
        let policy = CommandPolicy::from_config(&["cmd".to_string()]);
        #[cfg(not(windows))]
        let policy = CommandPolicy::from_config(&["sh".to_string()]);
        InMemoryProcessManager::with_policy(policy)
    }

    /// Poll until the process settles, or fail the test after ~4 seconds.
    async fn wait_for_terminal(manager: &dyn ProcessManager, id: &str) -> ProcessStatus {
        for _ in 0..200 {
            let status = manager.status(id).await.expect("the process is tracked");
            if status.is_terminal() {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("process `{id}` did not exit within four seconds");
    }

    #[tokio::test]
    async fn spawn_starts_a_process_and_status_reports_it_running() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = long_running();

        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the process starts");

        assert_eq!(id, "proc-1");
        assert_eq!(
            manager.status(&id).await.expect("the process is tracked"),
            ProcessStatus::Running
        );
        manager.stop(&id).await.expect("the process stops");
    }

    #[tokio::test]
    async fn spawn_hands_out_a_distinct_id_per_process() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = long_running();

        let first = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the first process starts");
        let second = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the second process starts");

        assert_ne!(first, second);
        assert_eq!(manager.list().await.len(), 2);
        manager.stop(&first).await.expect("the first process stops");
        manager
            .stop(&second)
            .await
            .expect("the second process stops");
    }

    #[tokio::test]
    async fn spawning_a_missing_binary_is_an_error() {
        let manager = InMemoryProcessManager::new();

        let error = manager
            .spawn("warsha-definitely-not-a-real-binary", &[], &HashMap::new())
            .await
            .expect_err("a missing binary cannot start");

        assert!(matches!(error, ProcessError::Spawn { .. }));
        assert!(manager.list().await.is_empty());
    }

    #[tokio::test]
    async fn an_empty_command_is_refused() {
        let manager = InMemoryProcessManager::new();

        let error = manager
            .spawn("   ", &[], &HashMap::new())
            .await
            .expect_err("a blank program is refused");

        assert!(matches!(error, ProcessError::EmptyCommand));
        assert!(manager.list().await.is_empty());
    }

    #[tokio::test]
    async fn stop_kills_the_process_and_marks_it_stopped() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = long_running();
        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the process starts");

        manager.stop(&id).await.expect("the process stops");

        assert_eq!(
            manager
                .status(&id)
                .await
                .expect("the process is still tracked"),
            ProcessStatus::Stopped
        );
    }

    #[tokio::test]
    async fn stop_on_a_finished_process_is_not_running() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = immediate_exit();
        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the process starts");
        wait_for_terminal(&manager, &id).await;

        let error = manager
            .stop(&id)
            .await
            .expect_err("nothing is left to kill");

        assert!(matches!(error, ProcessError::NotRunning(_)));
    }

    #[tokio::test]
    async fn a_finished_process_reports_its_exit_code() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = immediate_exit();
        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the process starts");

        assert_eq!(
            wait_for_terminal(&manager, &id).await,
            ProcessStatus::Stopped
        );

        let listed = manager.list().await;
        let process = listed.first().expect("the process is listed");
        assert_eq!(process.exit_code, Some(0));
        assert_eq!(process.status, ProcessStatus::Stopped);
        assert!(process.started_at.is_some());
    }

    #[tokio::test]
    async fn status_of_an_unknown_id_is_not_found() {
        let manager = InMemoryProcessManager::new();

        let error = manager
            .status("proc-404")
            .await
            .expect_err("an unknown id has no status");

        assert!(matches!(error, ProcessError::NotFound(_)));
    }

    #[tokio::test]
    async fn list_reports_every_process_without_its_child_handle() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = long_running();
        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the process starts");

        let listed = manager.list().await;

        assert_eq!(listed.len(), 1);
        let process = listed.first().expect("the process is listed");
        assert_eq!(process.id, id);
        assert_eq!(process.command, command);
        assert_eq!(process.args, args);
        assert!(process.child.is_none(), "list never hands out the handle");
        assert_eq!(process.status, ProcessStatus::Running);
        assert_eq!(process.summary().id, id, "the summary keeps the id");
        manager.stop(&id).await.expect("the process stops");
    }

    #[tokio::test]
    async fn restart_keeps_the_id_and_starts_a_new_child() {
        let manager = shell_manager();
        let (command, args) = long_running();
        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the process starts");

        let restarted = manager.restart(&id).await.expect("the process restarts");

        assert_eq!(restarted, id);
        assert_eq!(
            manager.status(&id).await.expect("the process is tracked"),
            ProcessStatus::Running
        );
        assert_eq!(manager.list().await.len(), 1, "a restart reuses the record");
        manager.stop(&id).await.expect("the process stops");
    }

    #[tokio::test]
    async fn restart_replays_the_environment_it_was_spawned_with() {
        let manager = shell_manager();
        let (command, args) = long_running();
        let mut env = HashMap::new();
        env.insert("WARSHA_TEST_MARKER".to_string(), "1".to_string());
        let id = manager
            .spawn(&command, &args, &env)
            .await
            .expect("the process starts");

        manager.restart(&id).await.expect("the process restarts");

        // The environment is replayed from the record, so a restart of a process
        // that never read it still succeeds rather than losing the setting.
        assert_eq!(
            manager.status(&id).await.expect("the process is tracked"),
            ProcessStatus::Running
        );
        manager.stop(&id).await.expect("the process stops");
    }

    /// KEEL checkpoint finding M4: `restart` re-spawned the stored command with no
    /// policy re-check, so a record could re-launch a program the daemon would now
    /// refuse. The manager holds the policy, so the re-check cannot be forgotten by
    /// a caller; it runs before the running child is touched, so a refusal leaves
    /// the process as it was. A command the policy admits still restarts.
    #[tokio::test]
    async fn restart_rechecks_the_policy_before_respawning() {
        // The shipped policy refuses a shell, and `spawn` is gated at the RPC edge,
        // so this record exists exactly as one does after a narrowing.
        let manager = InMemoryProcessManager::new();
        let (command, args) = long_running();
        let expected = CommandPolicy::default()
            .check_invocation(&command, &args)
            .expect_err("the shipped policy refuses this program");
        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the record exists");

        let error = manager
            .restart(&id)
            .await
            .expect_err("a program the policy refuses cannot be re-spawned");
        match error {
            ProcessError::PolicyRefused {
                id: refused,
                reason,
            } => {
                assert_eq!(refused, id, "the refusal names the process");
                assert_eq!(
                    reason,
                    expected.to_string(),
                    "the refusal carries the policy's own message"
                );
                assert!(
                    reason.contains(&command),
                    "the refusal names the program: {reason}"
                );
            }
            other => panic!("expected PolicyRefused, got {other:?}"),
        }
        assert_eq!(
            manager.status(&id).await.expect("the process is tracked"),
            ProcessStatus::Running,
            "a refused restart leaves the running child alone"
        );
        assert_eq!(manager.list().await.len(), 1, "no second record was made");
        manager.stop(&id).await.expect("the process stops");

        // Control: the same command, under a policy that admits it, restarts.
        let admitting = shell_manager();
        let id = admitting
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the process starts");
        assert_eq!(
            admitting
                .restart(&id)
                .await
                .expect("an admitted program restarts"),
            id
        );
        assert_eq!(
            admitting.status(&id).await.expect("the process is tracked"),
            ProcessStatus::Running
        );
        admitting.stop(&id).await.expect("the process stops");
    }

    #[tokio::test]
    async fn restarting_an_unknown_process_is_not_found() {
        let manager = InMemoryProcessManager::new();

        let error = manager
            .restart("proc-404")
            .await
            .expect_err("an unknown id cannot restart");

        assert!(matches!(error, ProcessError::NotFound(_)));
    }

    #[tokio::test]
    async fn write_stdin_reaches_the_child_and_an_unknown_id_is_refused() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = long_running();
        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the process starts");

        manager
            .write_stdin(&id, b"{\"jsonrpc\":\"2.0\"}\n")
            .await
            .expect("the frame is written to the pipe");

        let error = manager
            .write_stdin("proc-404", b"x")
            .await
            .expect_err("an unknown id has no stdin");
        assert!(matches!(error, ProcessError::NotFound(_)));
        manager.stop(&id).await.expect("the process stops");
    }

    #[tokio::test]
    async fn read_stdout_reports_what_a_child_printed_and_advances_a_cursor() {
        let manager = InMemoryProcessManager::new();
        let (command, args) =
            LivePreviewManager::split_command(&probe_line()).expect("the probe line splits");
        let id = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the probe starts");

        let lines = wait_for_output(&manager, &id).await;
        assert!(
            lines.iter().any(|line| line.contains(PROBE_URL)),
            "the probe's banner should be captured: {lines:?}"
        );
        // A caller that has read those lines is not handed them twice.
        assert!(manager
            .read_stdout(&id, lines.len())
            .await
            .expect("the process is tracked")
            .is_empty());
        assert!(matches!(
            manager.read_stdout("proc-404", 0).await,
            Err(ProcessError::NotFound(_))
        ));

        assert_eq!(manager.kill_all().await, 1);
    }

    #[tokio::test]
    async fn kill_all_kills_and_reaps_every_live_child() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = long_running();
        let first = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the first child starts");
        let second = manager
            .spawn(&command, &args, &HashMap::new())
            .await
            .expect("the second child starts");

        // A child that already exited is not a child to kill.
        let (done_command, done_args) = immediate_exit();
        let done = manager
            .spawn(&done_command, &done_args, &HashMap::new())
            .await
            .expect("the child that exits starts");
        wait_for_terminal(&manager, &done).await;

        assert_eq!(manager.kill_all().await, 2);

        for id in [&first, &second] {
            assert_eq!(
                manager.status(id).await.expect("the process is tracked"),
                ProcessStatus::Stopped,
                "`{id}` should be settled by the sweep"
            );
        }
        // Nothing is left to kill, and nothing was left behind as a zombie: a
        // sweep that did not wait for its children would still see them here.
        assert_eq!(manager.kill_all().await, 0);
    }

    #[test]
    fn split_command_keeps_the_program_and_its_arguments() {
        let (program, args) =
            LivePreviewManager::split_command("npm run dev").expect("the line splits");

        assert_eq!(program, "npm");
        assert_eq!(args, vec!["run".to_string(), "dev".to_string()]);
        assert!(matches!(
            LivePreviewManager::split_command("   "),
            Err(ProcessError::EmptyCommand)
        ));
    }

    #[test]
    fn split_command_keeps_a_quoted_program_path_with_spaces() {
        let (program, args) =
            LivePreviewManager::split_command("\"C:/Program Files/x/node.exe\" run dev")
                .expect("the quoted line splits");

        assert_eq!(program, "C:/Program Files/x/node.exe");
        assert_eq!(args, vec!["run".to_string(), "dev".to_string()]);
    }

    #[test]
    fn split_command_single_quotes_are_literal() {
        let (program, args) = LivePreviewManager::split_command("echo 'hello world' 'a\"b'")
            .expect("the line splits");

        assert_eq!(program, "echo");
        // Inside single quotes nothing is an escape: the space and the double
        // quote are both literal.
        assert_eq!(args, vec!["hello world".to_string(), "a\"b".to_string()]);
    }

    #[test]
    fn split_command_double_quote_escapes_and_adjacent_joining() {
        // `\"` and `\\` are the only double-quote escapes.
        let (program, args) =
            LivePreviewManager::split_command("echo \"say \\\"hi\\\" now\" \"a\\\\b\"")
                .expect("the line splits");
        assert_eq!(program, "echo");
        assert_eq!(args, vec!["say \"hi\" now".to_string(), "a\\b".to_string()]);

        // Adjacent quoted and unquoted parts join into one token.
        let (joined, rest) =
            LivePreviewManager::split_command("a\"b c\"d").expect("the line splits");
        assert_eq!(joined, "ab cd");
        assert!(rest.is_empty());
    }

    #[test]
    fn split_command_windows_backslash_path_survives_double_quotes() {
        // A backslash before any character but `"` or `\` stays literal, which is
        // what lets a quoted Windows executable path keep its separators.
        let (program, args) =
            LivePreviewManager::split_command("\"C:\\Program Files\\x\\node.exe\" run dev")
                .expect("the quoted line splits");

        assert_eq!(program, "C:\\Program Files\\x\\node.exe");
        assert_eq!(args, vec!["run".to_string(), "dev".to_string()]);
    }

    #[test]
    fn split_command_unterminated_quote_is_an_error() {
        assert!(matches!(
            LivePreviewManager::split_command("echo \"unclosed"),
            Err(ProcessError::UnterminatedQuote { quote: '"' })
        ));
        assert!(matches!(
            LivePreviewManager::split_command("echo 'unclosed"),
            Err(ProcessError::UnterminatedQuote { quote: '\'' })
        ));
    }

    #[test]
    fn discover_url_reads_the_first_address_a_transcript_carries() {
        let banner = vec!["  ➜  Local:   http://localhost:5173/".to_string()];
        assert_eq!(
            discover_url(&banner),
            Some("http://localhost:5173/".to_string())
        );

        // Punctuation a banner appended is not part of the address, and an https
        // port is not punctuation.
        let trailing = vec!["ready at https://example.test:8443/app).".to_string()];
        assert_eq!(
            discover_url(&trailing),
            Some("https://example.test:8443/app".to_string())
        );

        // The first address wins, and a line without one is skipped.
        let two = vec![
            "vite v5.4.0 ready in 300 ms".to_string(),
            "  Local:   http://first.test/   Network: https://second.test/".to_string(),
        ];
        assert_eq!(discover_url(&two), Some("http://first.test/".to_string()));

        // A scheme with no host names nothing, and an empty transcript has none.
        assert_eq!(discover_url(&["http://".to_string()]), None);
        assert_eq!(discover_url(&[]), None);
    }

    #[tokio::test]
    async fn preview_reports_the_url_the_dev_server_printed() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes.clone());

        let started = previews
            .start("project-1", &probe_line(), None)
            .await
            .expect("the preview starts");

        assert_eq!(started.url.as_deref(), Some(PROBE_URL));
        // The status reads the same transcript, so a caller that polls the panel
        // sees the address even if it never looked at the start reply.
        assert_eq!(
            previews
                .status("project-1", None)
                .await
                .expect("the preview is tracked")
                .url
                .as_deref(),
            Some(PROBE_URL)
        );
        previews.stop("project-1").await.expect("the preview stops");
        assert_eq!(
            processes.kill_all().await,
            0,
            "the server is already stopped"
        );
    }

    #[tokio::test]
    async fn preview_url_stays_none_when_the_server_prints_no_address() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes.clone());

        let started = previews
            .start(
                "project-1",
                &probe_line_for("process_spawn::tests::preview_silent_probe"),
                None,
            )
            .await
            .expect("the preview starts");

        // The server is up and quiet, and that is `None` rather than a guess.
        assert_eq!(started.url, None);
        assert_eq!(
            processes
                .status(&started.process_id)
                .await
                .expect("the server is tracked"),
            ProcessStatus::Running
        );
        previews.stop("project-1").await.expect("the preview stops");
    }

    #[tokio::test]
    async fn preview_starts_reports_and_stops_its_dev_server() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes.clone());
        let command = probe_line();

        let started = previews
            .start("project-1", &command, None)
            .await
            .expect("the preview starts");
        let status = previews
            .status("project-1", None)
            .await
            .expect("the preview is tracked");

        assert_eq!(status.project_id, "project-1");
        assert_eq!(status.process_id, started.process_id);
        assert_eq!(status.status, ProcessStatus::Running);

        previews.stop("project-1").await.expect("the preview stops");
        assert_eq!(
            previews
                .status("project-1", None)
                .await
                .expect("the preview is still tracked")
                .status,
            ProcessStatus::Stopped
        );
    }

    #[tokio::test]
    async fn a_second_start_for_the_same_project_is_refused() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes);
        let command = probe_line();
        previews
            .start("project-1", &command, None)
            .await
            .expect("the preview starts");

        let error = previews
            .start("project-1", &command, None)
            .await
            .expect_err("one preview per project");

        assert!(matches!(error, ProcessError::PreviewAlreadyRunning(_)));
        previews.stop("project-1").await.expect("the preview stops");
    }

    #[tokio::test]
    async fn preview_status_and_stop_of_an_unknown_project_are_not_found() {
        let previews = LivePreviewManager::new(InMemoryProcessManager::shared());

        assert!(matches!(
            previews.status("nobody", None).await,
            Err(ProcessError::PreviewNotFound(_))
        ));
        assert!(matches!(
            previews.stop("nobody").await,
            Err(ProcessError::PreviewNotFound(_))
        ));
        assert!(matches!(
            previews.start("  ", "npm run dev", None).await,
            Err(ProcessError::EmptyProjectId)
        ));
        assert!(previews.list().await.is_empty());
    }

    #[tokio::test]
    async fn stopping_a_preview_twice_is_not_an_error() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes.clone());
        let started = previews
            .start("project-1", &probe_line(), None)
            .await
            .expect("the preview starts");
        let status = processes
            .status(&started.process_id)
            .await
            .expect("the process is tracked");
        assert_eq!(status, ProcessStatus::Running);

        previews.stop("project-1").await.expect("the preview stops");
        previews
            .stop("project-1")
            .await
            .expect("stopping a stopped preview succeeds");
    }

    /// A run's server is its own: a later run on the same project is refused.
    ///
    /// The daemon-level half of T1 (`second_run_never_inherits_a_live_server`) is
    /// the store-backed run context; this is the manager rule under it — ownership,
    /// not the port, is what the refusal names.
    #[tokio::test]
    async fn a_live_server_owned_by_another_live_run_is_not_a_newcomers_to_take() {
        let processes = InMemoryProcessManager::shared();
        let live = LiveRuns::of(&["run-a", "run-b"]);
        let previews = LivePreviewManager::new(processes.clone()).with_run_liveness(live.clone());

        let first = previews
            .start("project-1", &probe_line(), Some("run-a"))
            .await
            .expect("run A starts its server");

        let error = previews
            .start("project-1", &probe_line(), Some("run-b"))
            .await
            .expect_err("run B cannot take run A's live server");
        match error {
            ProcessError::PreviewOwnedByRun {
                project,
                owner,
                run_id,
            } => {
                assert_eq!(project, "project-1");
                assert_eq!(owner, "run-a");
                assert_eq!(run_id, "run-b");
            }
            other => panic!("a refused takeover answered {other:?}"),
        }

        // The refusal changed nothing: run A's server is exactly where it was.
        assert_eq!(
            previews
                .status("project-1", Some("run-a"))
                .await
                .expect("run A's server is still its own")
                .process_id,
            first.process_id
        );
        // The same run asking twice is the one-preview-per-project rule, not a
        // takeover: it already has the server it asked for.
        assert!(matches!(
            previews
                .start("project-1", &probe_line(), Some("run-a"))
                .await,
            Err(ProcessError::PreviewAlreadyRunning(_))
        ));

        assert_eq!(previews.stop_run("run-a").await, 1);
        assert_eq!(
            processes.kill_all().await,
            0,
            "the run's close stopped its server"
        );
    }

    /// `stop_run` stops and drops every server the run owns, and nobody else's.
    #[tokio::test]
    async fn stop_run_stops_the_servers_the_run_owns_and_only_those() {
        let processes = InMemoryProcessManager::shared();
        let live = LiveRuns::of(&["run-a", "run-b"]);
        let previews = LivePreviewManager::new(processes.clone()).with_run_liveness(live);

        let owned = previews
            .start("project-1", &probe_line(), Some("run-a"))
            .await
            .expect("run A's first server starts");
        let owned_elsewhere = previews
            .start("project-2", &probe_line(), Some("run-a"))
            .await
            .expect("run A's second server starts");
        let kept = previews
            .start("project-3", &probe_line(), Some("run-b"))
            .await
            .expect("run B's server starts");

        assert_eq!(previews.stop_run("run-a").await, 2);

        for (project, process_id) in [
            ("project-1", owned.process_id),
            ("project-2", owned_elsewhere.process_id),
        ] {
            assert_eq!(
                processes
                    .status(&process_id)
                    .await
                    .expect("the process is tracked"),
                ProcessStatus::Stopped,
                "{project}'s server did not stop with its run"
            );
            assert!(
                matches!(
                    previews.status(project, None).await,
                    Err(ProcessError::PreviewNotFound(_))
                ),
                "{project}'s entry outlived its run"
            );
        }

        // Another run's server is untouched, entry and process both.
        assert_eq!(
            previews
                .status("project-3", Some("run-b"))
                .await
                .expect("run B's server is still tracked")
                .process_id,
            kept.process_id
        );
        assert_eq!(
            processes
                .status(&kept.process_id)
                .await
                .expect("the process is tracked"),
            ProcessStatus::Running
        );

        assert_eq!(previews.stop_run("run-b").await, 1);
        assert_eq!(processes.kill_all().await, 0);
    }

    /// T5 (R-BRIDGE-B5 D2): a stop that fails is logged, and the close still
    /// answers — `stop_run` has no error to return, so no run close can fail on it.
    #[tokio::test]
    async fn stop_failure_never_fails_run_close() {
        let processes = Unstoppable::new();
        let previews = LivePreviewManager::new(processes.clone());

        let started = previews
            .start("project-1", &probe_line(), Some("run-a"))
            .await
            .expect("run A starts its server");

        // The poisoned kill is attempted, refused, and swallowed.
        assert_eq!(previews.stop_run("run-a").await, 1);
        assert_eq!(
            processes.refusals(),
            1,
            "the close did not try to stop the server it owns"
        );
        // The entry is gone anyway: a run that ends leaves no preview behind, not
        // even a server that would not die.
        assert!(matches!(
            previews.status("project-1", None).await,
            Err(ProcessError::PreviewNotFound(_))
        ));
        assert!(previews.list().await.is_empty());

        // The child the poisoned manager would not kill is reaped here, so the test
        // leaves no process behind.
        assert_eq!(processes.inner.kill_all().await, 1);
        assert_eq!(
            processes
                .status(&started.process_id)
                .await
                .expect("the process is tracked"),
            ProcessStatus::Stopped
        );
    }

    /// T6 (R-BRIDGE-B5 D5): previews are process memory — a rebuilt manager starts
    /// clean, and nothing of the old one blocks or answers.
    #[tokio::test]
    async fn restart_starts_clean() {
        let processes = InMemoryProcessManager::shared();
        let live = LiveRuns::of(&["run-a"]);
        let before = LivePreviewManager::new(processes.clone()).with_run_liveness(live.clone());
        let started = before
            .start("project-1", &probe_line(), Some("run-a"))
            .await
            .expect("the first manager starts a server");

        // The daemon restart: the processes are the daemon's, the entries are not.
        let after = LivePreviewManager::new(processes.clone()).with_run_liveness(live);

        assert!(after.list().await.is_empty(), "a restart kept a preview");
        assert!(
            matches!(
                after.status("project-1", None).await,
                Err(ProcessError::PreviewNotFound(_))
            ),
            "a restarted manager answered for the previous manager's server"
        );
        // Not just absent from the list: the next run starts clean, unblocked by an
        // entry nobody kept.
        let fresh = after
            .start("project-1", &probe_line(), Some("run-a"))
            .await
            .expect("a restarted manager starts a server of its own");
        assert_ne!(fresh.process_id, started.process_id);

        assert_eq!(after.stop_run("run-a").await, 1);
        // The restarted manager stops what *it* started. The child the previous
        // manager left is exactly what a restart forgets — the known half in
        // PLAN.md — so it is still alive here and only this test can reap it.
        assert_eq!(
            processes.kill_all().await,
            1,
            "the server the old manager started outlived it, as a restart does"
        );
    }

    /// A run context answers for the run's server; another run's is not its own.
    #[tokio::test]
    async fn status_in_a_run_context_reports_only_that_runs_server() {
        let processes = InMemoryProcessManager::shared();
        let live = LiveRuns::of(&["run-a", "run-b"]);
        let previews = LivePreviewManager::new(processes.clone()).with_run_liveness(live);

        let started = previews
            .start("project-1", &probe_line(), Some("run-a"))
            .await
            .expect("run A starts its server");

        assert_eq!(
            previews
                .status("project-1", Some("run-a"))
                .await
                .expect("run A's own server answers")
                .process_id,
            started.process_id
        );
        assert!(
            matches!(
                previews.status("project-1", Some("run-b")).await,
                Err(ProcessError::PreviewNotFound(_))
            ),
            "run B was answered with run A's server"
        );
        // Without a run context the project's server is the answer, so a
        // project-scoped status call keeps working (D1).
        assert_eq!(
            previews
                .status("project-1", None)
                .await
                .expect("a project-scoped status answers")
                .process_id,
            started.process_id
        );

        assert_eq!(previews.stop_run("run-a").await, 1);
        assert_eq!(processes.kill_all().await, 0);
    }

    /// Without a run source nothing can be proved dead, so an owner is treated as
    /// live: the no-steal rule holds rather than a stranger taking the server.
    #[tokio::test]
    async fn a_manager_with_no_run_source_never_lets_a_newcomer_take_a_server() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes.clone());

        previews
            .start("project-1", &probe_line(), Some("run-a"))
            .await
            .expect("the server starts");

        assert!(matches!(
            previews
                .start("project-1", &probe_line(), Some("run-b"))
                .await,
            Err(ProcessError::PreviewOwnedByRun { .. })
        ));

        assert_eq!(previews.stop_run("run-a").await, 1);
        assert_eq!(processes.kill_all().await, 0);
    }

    /// A dead owner's entry never blocks the next run, and is stopped as it goes.
    #[tokio::test]
    async fn a_dead_runs_entry_is_swept_instead_of_blocking_the_next_run() {
        let processes = InMemoryProcessManager::shared();
        let live = LiveRuns::of(&["run-a", "run-b"]);
        let previews = LivePreviewManager::new(processes.clone()).with_run_liveness(live.clone());

        let abandoned = previews
            .start("project-1", &probe_line(), Some("run-a"))
            .await
            .expect("run A starts its server");
        // Run A died without its close running: the record says over, no hook ran.
        live.finish("run-a");

        // The next status for the project is what sweeps it ...
        assert!(matches!(
            previews.status("project-1", None).await,
            Err(ProcessError::PreviewNotFound(_))
        ));
        assert_eq!(
            processes
                .status(&abandoned.process_id)
                .await
                .expect("the process is tracked"),
            ProcessStatus::Stopped,
            "the swept server was left running"
        );

        // ... and the next run starts clean rather than refused.
        let fresh = previews
            .start("project-1", &probe_line(), Some("run-b"))
            .await
            .expect("the next run starts its own server");
        assert_ne!(fresh.process_id, abandoned.process_id);

        assert_eq!(previews.stop_run("run-b").await, 1);
        assert_eq!(processes.kill_all().await, 0);
    }

    /// A start with no run id keeps the old rule exactly: one preview per project.
    #[tokio::test]
    async fn a_start_without_a_run_is_still_one_preview_per_project() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes.clone());

        previews
            .start("project-1", &probe_line(), None)
            .await
            .expect("the project's own server starts");
        assert!(matches!(
            previews
                .start("project-1", &probe_line(), Some("run-a"))
                .await,
            Err(ProcessError::PreviewAlreadyRunning(_))
        ));
        // An untagged server is nobody's, so no run close takes it with it.
        assert_eq!(previews.stop_run("run-a").await, 0);

        previews.stop("project-1").await.expect("the preview stops");
        assert_eq!(processes.kill_all().await, 0);
    }
}

/// KEEL K5a — the spawn floor a child is started from.
///
/// These probes spawn *this test binary* as a child, selected by `--exact`, and
/// the child does nothing unless the parent handed it a marker in the environment
/// it was spawned with. That keeps the probes real — an OS process reading an
/// environment built by [`command_for`] — without depending on a shell, a Python
/// interpreter or any other program the host may not have.
#[cfg(test)]
mod spawn_hardening {
    use super::*;

    /// Child-mode markers; the parent passes each one in the spawn environment.
    const ENV_DUMP_MARKER: &str = "WARSHA_K5_ENV_DUMP";
    const STDERR_MARKER: &str = "WARSHA_K5_STDERR";
    /// A variable that exists in the *parent* test process and must not be
    /// inherited by the child.
    const PARENT_MARKER: &str = "WARSHA_K5_PARENT_MARKER";
    /// A credential-shaped string, so redaction has something to remove.
    const PROBE_SECRET: &str = "sk-ABCDEFGH12345678";

    fn probe_process(test: &str) -> (String, Vec<String>) {
        let exe = std::env::current_exe().expect("the test binary names itself");
        (
            exe.display().to_string(),
            vec![
                "--exact".to_string(),
                test.to_string(),
                "--nocapture".to_string(),
                "--test-threads".to_string(),
                "1".to_string(),
            ],
        )
    }

    /// Prints three facts about the environment the manager built.
    ///
    /// Harmless in a full test run: without the marker the parent passes it
    /// returns immediately.
    #[test]
    fn environment_dump_probe() {
        if std::env::var_os(ENV_DUMP_MARKER).is_none() {
            return;
        }
        use std::io::Write;
        let path = std::env::var("PATH").unwrap_or_default();
        let parent = std::env::var_os(PARENT_MARKER).is_some();
        let home = std::env::var_os("HOME").is_some() || std::env::var_os("USERPROFILE").is_some();
        let loader = std::env::var_os("LD_PRELOAD").is_some()
            || std::env::var_os("DYLD_INSERT_LIBRARIES").is_some();
        let stdout = std::io::stdout();
        let mut out = stdout.lock();
        let _ = writeln!(out, "ENVDUMP PATH={path}");
        let _ = writeln!(out, "ENVDUMP PARENT={parent}");
        let _ = writeln!(out, "ENVDUMP HOME={home}");
        let _ = writeln!(out, "ENVDUMP LOADER={loader}");
        let _ = out.flush();
    }

    /// Writes a credential-shaped token to stderr.
    #[test]
    fn stderr_probe() {
        if std::env::var_os(STDERR_MARKER).is_none() {
            return;
        }
        use std::io::Write;
        let stderr = std::io::stderr();
        let mut out = stderr.lock();
        let _ = writeln!(out, "probe failed with {PROBE_SECRET} while starting");
        let _ = out.flush();
    }

    /// Poll until the child has printed a line with `prefix`, or fail after ~4 s.
    async fn wait_for_stdout(manager: &dyn ProcessManager, id: &str, prefix: &str) -> Vec<String> {
        for _ in 0..200 {
            let lines = manager
                .read_stdout(id, 0)
                .await
                .expect("the process is tracked");
            if lines.iter().any(|line| line.starts_with(prefix)) {
                return lines;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("process `{id}` printed no line starting `{prefix}`");
    }

    /// Poll until the child has printed something to stderr, or fail after ~4 s.
    async fn wait_for_stderr(manager: &dyn ProcessManager, id: &str) -> Vec<String> {
        for _ in 0..200 {
            let lines = manager
                .read_stderr(id, 0)
                .await
                .expect("the process is tracked");
            if !lines.is_empty() {
                return lines;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("process `{id}` printed nothing to stderr");
    }

    /// A variable the parent inherited never reaches the child, and the child's
    /// `PATH` is the trusted daemon `PATH` rather than an inherited or
    /// caller-supplied one (the accepted K4 policy; KEEL K5 review finding 5).
    #[tokio::test]
    async fn a_child_starts_from_a_cleared_environment_and_the_minimal_floor() {
        std::env::set_var(PARENT_MARKER, "leaked");

        struct Guard;
        impl Drop for Guard {
            fn drop(&mut self) {
                std::env::remove_var(PARENT_MARKER);
            }
        }
        let _guard = Guard;

        let manager = InMemoryProcessManager::new();
        let (command, args) =
            probe_process("process_spawn::spawn_hardening::environment_dump_probe");
        let mut env = HashMap::new();
        env.insert(ENV_DUMP_MARKER.to_string(), "1".to_string());
        // A caller cannot replace the floor, and cannot smuggle a loader hook.
        env.insert("PATH".to_string(), "/tmp/attacker-bin".to_string());
        env.insert("LD_PRELOAD".to_string(), "/tmp/evil.so".to_string());

        let id = manager
            .spawn(&command, &args, &env)
            .await
            .expect("the probe starts");
        let lines = wait_for_stdout(&manager, &id, "ENVDUMP LOADER=").await;
        let trusted_path = child_path();

        assert!(
            lines
                .iter()
                .any(|line| line.contains("ENVDUMP PARENT=false")),
            "the daemon's own variables must not be inherited: {lines:?}"
        );
        assert!(
            lines.iter().any(|line| line.contains("ENVDUMP HOME=false")),
            "the user profile must not be inherited: {lines:?}"
        );
        assert!(
            lines
                .iter()
                .any(|line| line.contains("ENVDUMP LOADER=false")),
            "a loader hook must never reach the child: {lines:?}"
        );
        assert!(
            lines
                .iter()
                .any(|line| line.contains(&format!("ENVDUMP PATH={trusted_path}"))),
            "the child's PATH must be the trusted daemon PATH, not the caller's: {lines:?}"
        );
        assert!(
            !lines.iter().any(|line| line.contains("/tmp/attacker-bin")),
            "a caller-supplied PATH must be refused: {lines:?}"
        );
        manager.kill_all().await;
    }

    /// What a server prints to stderr is captured with its credentials masked;
    /// the captured transcript cannot be read back as the secret.
    #[tokio::test]
    async fn a_childs_stderr_is_captured_redacted_and_never_inherited() {
        let manager = InMemoryProcessManager::new();
        let (command, args) = probe_process("process_spawn::spawn_hardening::stderr_probe");
        let mut env = HashMap::new();
        env.insert(STDERR_MARKER.to_string(), "1".to_string());

        let id = manager
            .spawn(&command, &args, &env)
            .await
            .expect("the probe starts");
        let lines = wait_for_stderr(&manager, &id).await;
        let transcript = lines.join("\n");

        assert!(
            transcript.contains(crate::guardrails::REDACTED),
            "the token must be masked in the captured transcript: {transcript}"
        );
        assert!(
            !transcript.contains(PROBE_SECRET),
            "the captured transcript must never hold the secret: {transcript}"
        );
        manager.kill_all().await;
    }
}

/// K5 repair gates: trusted PATH, byte-bounded capture, known-secret masking.
#[cfg(test)]
mod k5_repair {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    fn command_path(command: &Command) -> Option<String> {
        command
            .as_std()
            .get_envs()
            .find(|(key, _)| key.to_string_lossy() == "PATH")
            .and_then(|(_, value)| value.map(|value| value.to_string_lossy().into_owned()))
    }

    #[test]
    fn pm_path_uses_the_trusted_daemon_path() {
        assert!(!child_path().is_empty());
        let mut caller = HashMap::new();
        caller.insert("PATH".to_string(), "/caller/override".to_string());
        let command = command_for("probe", &[], &caller);
        assert_eq!(command_path(&command), Some(child_path()));
        assert_ne!(command_path(&command).as_deref(), Some("/caller/override"));
    }

    #[test]
    fn pm_path_retains_default_minimal_env_keys() {
        let command = command_for("probe", &[], &HashMap::new());
        let envs: HashMap<String, Option<String>> = command
            .as_std()
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|s| s.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert!(envs.contains_key("PATH"));
        assert!(envs.contains_key("LC_ALL"));
    }

    #[tokio::test]
    async fn pm_path_spawns_cargo_via_process_manager() {
        let manager = InMemoryProcessManager::new();
        let id = manager
            .spawn("cargo", &["--version".to_string()], &HashMap::new())
            .await
            .expect("ProcessManager spawns cargo via trusted child_path");
        let mut lines = Vec::new();
        for _ in 0..200 {
            lines = manager
                .read_stdout(&id, 0)
                .await
                .expect("process is tracked");
            if lines.iter().any(|l| l.starts_with("cargo ")) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            lines.iter().any(|l| l.starts_with("cargo ")),
            "cargo --version output missing: {lines:?}"
        );
        let _ = manager.stop(&id).await;
    }

    #[test]
    fn mask_values_come_from_the_child_environment() {
        let mut env = HashMap::new();
        env.insert(
            "SERVICE_TOKEN".to_string(),
            "k5-sentinel-secret-value-123".to_string(),
        );
        env.insert("SHORT".to_string(), "abc".to_string());
        assert_eq!(
            mask_values_for(&env),
            vec!["k5-sentinel-secret-value-123".to_string()]
        );
    }

    #[tokio::test]
    async fn stderr_bytes_stay_within_the_caps() {
        let mut input = vec![b'a'; 2 * 1024 * 1024];
        input.push(b'\n');
        let sink = Arc::new(Mutex::new(VecDeque::new()));
        drain_bounded("probe", &input[..], &sink, true, &[]).await;
        let captured = sink.lock().await;
        assert!(!captured.is_empty());
        let mut total = 0usize;
        for line in captured.iter() {
            assert!(
                line.len() <= MAX_CAPTURED_LINE_BYTES + TRUNCATION_MARKER.len(),
                "a captured line grew past the byte cap: {} bytes",
                line.len()
            );
            total += line.len();
        }
        assert!(
            total <= MAX_CAPTURED_STDERR_BYTES,
            "the ring held {total} bytes, past the cap"
        );
        assert!(captured
            .iter()
            .any(|line| line.ends_with(TRUNCATION_MARKER)));
    }

    #[tokio::test]
    async fn stderr_bytes_no_newline_stream_bounded_by_single_line_cap() {
        let input = vec![b'x'; MAX_CAPTURED_LINE_BYTES + 4096];
        let sink = Arc::new(Mutex::new(VecDeque::new()));
        drain_bounded("probe", &input[..], &sink, true, &[]).await;
        let captured = sink.lock().await;
        assert_eq!(captured.len(), 2);
        let line = &captured[0];
        assert!(line.len() <= MAX_CAPTURED_LINE_BYTES + TRUNCATION_MARKER.len());
        assert!(line.ends_with(TRUNCATION_MARKER));
    }

    #[tokio::test]
    async fn stderr_secret_is_masked_before_storage() {
        let secret = "k5-sentinel-secret-value-123";
        let transcript = format!("diagnostic before {secret} diagnostic after\n");
        let sink = Arc::new(Mutex::new(VecDeque::new()));
        drain_bounded(
            "probe",
            transcript.as_bytes(),
            &sink,
            true,
            &[secret.to_string()],
        )
        .await;
        let captured = sink.lock().await;
        let joined = captured.iter().cloned().collect::<Vec<_>>().join("\n");
        assert!(
            !joined.contains(secret),
            "the known secret survived masking: {joined}"
        );
        assert!(joined.contains("***"));
    }

    #[tokio::test]
    async fn stderr_secret_shape_masking_fallback_redacts_credentials() {
        let secret = format!("{}-{}", "sk", "1234567890abcdef12345678");
        let transcript = format!("error from provider with {secret} inside\n");
        let sink = Arc::new(Mutex::new(VecDeque::new()));
        drain_bounded("probe", transcript.as_bytes(), &sink, true, &[]).await;
        let captured = sink.lock().await;
        let joined = captured.iter().cloned().collect::<Vec<_>>().join("\n");
        assert!(
            !joined.contains(&secret),
            "credential was not masked: {joined}"
        );
        assert!(joined.contains(crate::guardrails::REDACTED));
    }

    #[tokio::test]
    async fn stderr_secret_spawned_child_redacts_sentinel_from_ring_and_tracing() {
        use std::sync::Mutex as StdMutex;
        use tracing::field::{Field, Visit};
        use tracing::Subscriber;

        struct CaptureVisitor(String);
        impl Visit for CaptureVisitor {
            fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                self.0.push_str(&format!(" {}={:?}", field.name(), value));
            }
            fn record_str(&mut self, field: &Field, value: &str) {
                self.0.push_str(&format!(" {}={}", field.name(), value));
            }
        }
        struct CaptureSubscriber(Arc<StdMutex<Vec<String>>>);
        impl Subscriber for CaptureSubscriber {
            fn enabled(&self, _: &tracing::Metadata<'_>) -> bool {
                true
            }
            fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
                tracing::span::Id::from_u64(1)
            }
            fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
            fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
            fn event(&self, event: &tracing::Event<'_>) {
                let mut v = CaptureVisitor(String::new());
                event.record(&mut v);
                if let Ok(mut g) = self.0.lock() {
                    g.push(v.0);
                }
            }
            fn enter(&self, _: &tracing::span::Id) {}
            fn exit(&self, _: &tracing::span::Id) {}
        }

        let secret = "k5-sentinel-secret-value-123";
        let logs = Arc::new(StdMutex::new(Vec::new()));
        let subscriber = CaptureSubscriber(logs.clone());
        let dispatch = tracing::Dispatch::new(subscriber);
        let _guard = tracing::dispatcher::set_default(&dispatch);

        let transcript = format!("plugin stderr line with {secret} emitted\n");
        let sink = Arc::new(Mutex::new(VecDeque::new()));
        drain_bounded(
            "probe",
            transcript.as_bytes(),
            &sink,
            true,
            &[secret.to_string()],
        )
        .await;

        let captured = sink.lock().await;
        let ring_joined = captured.iter().cloned().collect::<Vec<_>>().join("\n");
        assert!(!ring_joined.contains(secret));
        assert!(ring_joined.contains("***"));

        let logged = logs.lock().expect("logs lock").join("\n");
        assert!(
            !logged.contains(secret),
            "tracing event leaked known secret: {logged}"
        );
        assert!(
            logged.contains("***"),
            "tracing event must contain masked output: {logged}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_blocked_stdin_writer_does_not_block_the_entry_list() {
        let manager = InMemoryProcessManager::shared();
        let env: HashMap<String, String> = HashMap::new();
        let id = manager
            .spawn("sleep", &["30".to_string()], &env)
            .await
            .expect("sleep starts");
        let writer = {
            let manager = manager.clone();
            let id = id.clone();
            tokio::spawn(async move {
                let payload = vec![b'x'; 8 * 1024 * 1024];
                let _ = manager.write_stdin(&id, &payload).await;
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let listed = tokio::time::timeout(std::time::Duration::from_secs(2), manager.list())
            .await
            .expect("the entry list answers while a writer is blocked");
        assert_eq!(listed.len(), 1);
        writer.abort();
        let _ = manager.stop(&id).await;
    }
}
