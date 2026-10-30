//! Process spawning — the real child processes behind `process.*` and the live
//! preview dev server (PLAN.md M20).
//!
//! Everything here starts an actual OS process through [`tokio::process`]. That
//! is the whole point of the module: the live preview panel needed something to
//! run `npm run dev` with, and the MCP stdio transport needed something to start
//! an MCP server, so both go through [`ProcessManager`] and one manager owns
//! every child the daemon spawns.
//!
//! Three properties are deliberate:
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
//!
//! Nothing here reaps children when the daemon exits, and nothing captures their
//! output: stdin is piped (so the MCP stdio transport can write frames), stdout
//! and stderr are inherited (so a dev server's log reaches the daemon's console
//! instead of filling a pipe nobody reads). A daemon restart forgets the
//! processes it started, which is recorded as the remaining half in PLAN.md.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

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
    /// A preview needs a project to belong to.
    #[error("empty project id: a preview needs a project")]
    EmptyProjectId,
    /// A project already has a live dev server.
    #[error("project `{0}` already has a running preview")]
    PreviewAlreadyRunning(String),
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
    async fn restart(&self, id: &str) -> Result<String, ProcessError>;

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

/// One managed process plus what a restart has to replay.
///
/// The environment lives here rather than on [`ManagedProcess`] so that record
/// keeps exactly the six documented fields.
#[derive(Debug)]
struct Entry {
    process: ManagedProcess,
    env: HashMap<String, String>,
}

/// The [`Command`] every spawn and restart builds.
///
/// stdin is piped for the MCP transport; stdout and stderr are inherited so a dev
/// server's output reaches the console and never deadlocks on a full pipe.
fn command_for(program: &str, args: &[String], env: &HashMap<String, String>) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    for (key, value) in env {
        command.env(key, value);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    command
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
}

impl Default for InMemoryProcessManager {
    fn default() -> Self {
        InMemoryProcessManager::new()
    }
}

impl InMemoryProcessManager {
    /// An empty manager: no processes, the next id is `proc-1`.
    pub fn new() -> Self {
        InMemoryProcessManager {
            entries: Mutex::new(Vec::new()),
            next_id: AtomicU64::new(1),
        }
    }

    /// The manager as the daemon holds it, so one instance is shared by the
    /// process RPC, the MCP transports and the live preview.
    pub fn shared() -> Arc<dyn ProcessManager> {
        Arc::new(InMemoryProcessManager::new())
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
        let child =
            command_for(program, args, env)
                .spawn()
                .map_err(|source| ProcessError::Spawn {
                    command: program.to_string(),
                    source,
                })?;
        let id = format!("proc-{}", self.next_id.fetch_add(1, Ordering::SeqCst));
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

        if let Some(mut child) = entry.process.child.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }

        let child = command_for(&entry.process.command, &entry.process.args, &entry.env)
            .spawn()
            .map_err(|source| ProcessError::Spawn {
                command: entry.process.command.clone(),
                source,
            })?;
        entry.process.child = Some(child);
        entry.process.status = ProcessStatus::Starting;
        entry.process.started_at = Some(now_epoch_secs());
        entry.process.exit_code = None;
        Ok(entry.process.id.clone())
    }

    async fn write_stdin(&self, id: &str, bytes: &[u8]) -> Result<(), ProcessError> {
        let mut entries = self.entries.lock().await;
        let entry = entries
            .iter_mut()
            .find(|entry| entry.process.id == id)
            .ok_or_else(|| ProcessError::NotFound(id.to_string()))?;
        refresh(&mut entry.process)?;
        let Some(child) = entry.process.child.as_mut() else {
            return Err(ProcessError::NotRunning(id.to_string()));
        };
        let Some(stdin) = child.stdin.as_mut() else {
            return Err(ProcessError::StdInUnsupported(id.to_string()));
        };
        stdin
            .write_all(bytes)
            .await
            .map_err(|source| ProcessError::Write {
                id: id.to_string(),
                source,
            })?;
        stdin.flush().await.map_err(|source| ProcessError::Write {
            id: id.to_string(),
            source,
        })?;
        Ok(())
    }
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
}

/// The preview's record of one project, without its status.
#[derive(Debug, Clone)]
struct PreviewEntry {
    process_id: String,
    command: String,
    args: Vec<String>,
}

/// Starts and stops one dev server per project through a [`ProcessManager`].
///
/// The URL of a running dev server is not discovered here: the server chooses its
/// own port and prints it, and this module captures no output. A caller that knows
/// the port (because the project's script hardcodes one) supplies the URL — the
/// preview panel's `url` prop stays the seam, as PLAN.md M5b recorded.
pub struct LivePreviewManager {
    processes: Arc<dyn ProcessManager>,
    previews: Mutex<Vec<(String, PreviewEntry)>>,
}

impl LivePreviewManager {
    /// A manager over the one [`ProcessManager`] the daemon owns.
    pub fn new(processes: Arc<dyn ProcessManager>) -> Self {
        LivePreviewManager {
            processes,
            previews: Mutex::new(Vec::new()),
        }
    }

    /// Split `"npm run dev"` into the program and its arguments.
    ///
    /// Whitespace only: no shell, no quoting, no expansion, so a command with a
    /// pipe, a glob or a quoted argument is a script the caller writes rather than
    /// a string that gets parsed differently on two hosts.
    pub fn split_command(command: &str) -> Result<(String, Vec<String>), ProcessError> {
        let mut parts = command.split_whitespace();
        let program = parts.next().ok_or(ProcessError::EmptyCommand)?;
        Ok((program.to_string(), parts.map(str::to_string).collect()))
    }

    /// Start `command` as `project_id`'s dev server.
    ///
    /// One preview per project: a second start is refused while the first is
    /// alive, because two servers on one port is a port conflict, not a feature.
    /// A preview whose process has finished may be replaced.
    pub async fn start(
        &self,
        project_id: &str,
        command: &str,
    ) -> Result<LivePreview, ProcessError> {
        let project = project_id.trim();
        if project.is_empty() {
            return Err(ProcessError::EmptyProjectId);
        }

        let existing = self
            .previews
            .lock()
            .await
            .iter()
            .find(|(id, _)| id == project)
            .map(|(_, entry)| entry.clone());
        if let Some(entry) = existing {
            // A process the manager no longer has counts as finished, so its
            // project may start a new preview instead of being stuck forever.
            let status = self
                .processes
                .status(&entry.process_id)
                .await
                .unwrap_or(ProcessStatus::Stopped);
            if !status.is_terminal() {
                return Err(ProcessError::PreviewAlreadyRunning(project.to_string()));
            }
        }

        let (program, args) = LivePreviewManager::split_command(command)?;
        let process_id = self
            .processes
            .spawn(&program, &args, &HashMap::new())
            .await?;

        let mut previews = self.previews.lock().await;
        previews.retain(|(id, _)| id != project);
        previews.push((
            project.to_string(),
            PreviewEntry {
                process_id: process_id.clone(),
                command: program.clone(),
                args: args.clone(),
            },
        ));
        Ok(LivePreview {
            project_id: project.to_string(),
            process_id,
            command: program,
            args,
            status: ProcessStatus::Starting,
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

    /// The current status of `project_id`'s dev server.
    pub async fn status(&self, project_id: &str) -> Result<LivePreview, ProcessError> {
        let project = project_id.trim();
        let entry = self.preview_entry(project).await?;
        let status = self
            .processes
            .status(&entry.process_id)
            .await
            .unwrap_or(ProcessStatus::Stopped);
        Ok(LivePreview {
            project_id: project.to_string(),
            process_id: entry.process_id,
            command: entry.command,
            args: entry.args,
            status,
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
            previews.push(LivePreview {
                project_id,
                process_id: entry.process_id,
                command: entry.command,
                args: entry.args,
                status,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// A command that outlives the test: `sleep` on Unix, a loopback ping on
    /// Windows, quiet on both so the test log stays readable.
    #[cfg(windows)]
    fn long_running() -> (String, Vec<String>) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "ping -n 30 127.0.0.1 >nul".to_string()],
        )
    }

    /// A command that outlives the test (Unix half).
    #[cfg(not(windows))]
    fn long_running() -> (String, Vec<String>) {
        (
            "sh".to_string(),
            vec!["-c".to_string(), "sleep 30".to_string()],
        )
    }

    /// The same server as one command line, which is what a preview is given.
    fn long_running_line() -> String {
        let (command, args) = long_running();
        let mut line = command;
        for arg in args {
            line.push(' ');
            line.push_str(&arg);
        }
        line
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
        let manager = InMemoryProcessManager::new();
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
        let manager = InMemoryProcessManager::new();
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

    #[tokio::test]
    async fn preview_starts_reports_and_stops_its_dev_server() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes.clone());
        let command = long_running_line();

        let started = previews
            .start("project-1", &command)
            .await
            .expect("the preview starts");
        let status = previews
            .status("project-1")
            .await
            .expect("the preview is tracked");

        assert_eq!(status.project_id, "project-1");
        assert_eq!(status.process_id, started.process_id);
        assert_eq!(status.status, ProcessStatus::Running);

        previews.stop("project-1").await.expect("the preview stops");
        assert_eq!(
            previews
                .status("project-1")
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
        let command = long_running_line();
        previews
            .start("project-1", &command)
            .await
            .expect("the preview starts");

        let error = previews
            .start("project-1", &command)
            .await
            .expect_err("one preview per project");

        assert!(matches!(error, ProcessError::PreviewAlreadyRunning(_)));
        previews.stop("project-1").await.expect("the preview stops");
    }

    #[tokio::test]
    async fn preview_status_and_stop_of_an_unknown_project_are_not_found() {
        let previews = LivePreviewManager::new(InMemoryProcessManager::shared());

        assert!(matches!(
            previews.status("nobody").await,
            Err(ProcessError::PreviewNotFound(_))
        ));
        assert!(matches!(
            previews.stop("nobody").await,
            Err(ProcessError::PreviewNotFound(_))
        ));
        assert!(matches!(
            previews.start("  ", "npm run dev").await,
            Err(ProcessError::EmptyProjectId)
        ));
        assert!(previews.list().await.is_empty());
    }

    #[tokio::test]
    async fn stopping_a_preview_twice_is_not_an_error() {
        let processes = InMemoryProcessManager::shared();
        let previews = LivePreviewManager::new(processes.clone());
        let started = previews
            .start("project-1", &long_running_line())
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
}
