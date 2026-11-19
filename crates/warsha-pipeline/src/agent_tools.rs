//! Agent tools — the file and command layer Agent mode drives.
//!
//! One [`AgentTool`] is one call: read a text file, write a text file, or run a
//! program. [`ToolExecutor`] is the seam a caller implements; [`crate::AgentLoop`]
//! holds one as `Box<dyn ToolExecutor>`, so a unit test can drive a fake and the
//! daemon drives [`FilesystemToolExecutor`].
//!
//! [`FilesystemToolExecutor`] keeps every path inside its working directory: a
//! blank path, an absolute path and any `..` are refused before a file is touched
//! ([`ToolError::PathEscapesWorkingDir`]). That screen is this module's own —
//! `handoff.rs` has a private one for bundle paths, and reaching into it would be
//! the cross-module private access `ARCH_RULES.md` R4 forbids.
//!
//! A command runs through [`crate::CommandPolicy`] (backed by `tokio::process`)
//! with the working directory as its `current_dir`, `env_clear()` plus a minimal
//! fixed environment, a 120-second default timeout, and a 1 MiB output cap. A
//! non-zero exit is a *result* (`success: false`, with stdout, stderr and the code
//! in the output) rather than an error: the command ran and failed, which is what
//! a loop needs to read. Policy refusals and spawn/timeout failures are
//! [`ToolError`] values surfaced to the agent as failed tool results.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::command_policy::{CommandPolicy, CommandPolicyError};
use crate::work_protection::{
    classify_command, PermissionMode, ReadBeforeWriteGuard, RiskClass, WorkProtectionPolicy,
};

/// One tool call.
///
/// Serialises with a `tool` tag and `snake_case` names, so a turn result on the
/// wire names the call it made: `{"tool": "read_file", "path": "src/main.rs"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "tool", rename_all = "snake_case")]
pub enum AgentTool {
    /// Read a UTF-8 text file, relative to the executor's working directory.
    ReadFile {
        /// The file to read.
        path: String,
    },
    /// Write a text file, relative to the executor's working directory.
    WriteFile {
        /// The file to write.
        path: String,
        /// The whole file content.
        content: String,
    },
    /// Run a program with arguments in the working directory.
    RunCommand {
        /// The program to run.
        command: String,
        /// Its arguments, already split.
        args: Vec<String>,
    },
    /// Call an MCP tool on a connected server.
    CallTool {
        /// The server to call, or `None` to auto-discover among connected servers.
        server: Option<String>,
        /// The tool name to invoke.
        #[serde(rename = "tool_name")]
        tool: String,
        /// The arguments payload passed to the tool.
        arguments: serde_json::Value,
    },
}

impl AgentTool {
    /// `read_file src/main.rs` — one line naming the tool and its target.
    ///
    /// The written content is left out: it can be a whole file, and a summary line
    /// is what a response quotes.
    pub fn summary(&self) -> String {
        match self {
            AgentTool::ReadFile { path } => format!("read_file {path}"),
            AgentTool::WriteFile { path, .. } => format!("write_file {path}"),
            AgentTool::RunCommand { command, args } => {
                if args.is_empty() {
                    format!("run_command {command}")
                } else {
                    format!("run_command {command} {}", args.join(" "))
                }
            }
            AgentTool::CallTool { server, tool, .. } => match server {
                Some(s) => format!("call_tool {s}/{tool}"),
                None => format!("call_tool {tool}"),
            },
        }
    }
}

/// What one tool call produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolResult {
    /// The call that produced this result.
    pub tool: AgentTool,
    /// Whether the tool did what it was asked. A command that exits non-zero is
    /// `false` with its output still in [`ToolResult::output`].
    pub success: bool,
    /// The file content, the write receipt, or the command's output.
    pub output: String,
}

impl ToolResult {
    /// A result for `tool` with `output`.
    pub fn new(tool: AgentTool, success: bool, output: impl Into<String>) -> Self {
        Self {
            tool,
            success,
            output: output.into(),
        }
    }

    /// A result that did what it was asked.
    pub fn ok(tool: AgentTool, output: impl Into<String>) -> Self {
        Self::new(tool, true, output)
    }

    /// A result that did not, with the reason as its output.
    pub fn failed(tool: AgentTool, output: impl Into<String>) -> Self {
        Self::new(tool, false, output)
    }

    /// `ok` or `failed` — the word a one-line response quotes.
    pub fn status(&self) -> &'static str {
        if self.success {
            "ok"
        } else {
            "failed"
        }
    }
}

/// Why a tool could not do what it was asked.
///
/// Neither a missing file nor a failing command is here: both are results with
/// `success: false`. These are the refusals and the failures to even start.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ToolError {
    /// The path was blank.
    #[error("the path is blank")]
    BlankPath,
    /// The path left the working directory.
    #[error("the path must stay inside the working directory: {0}")]
    PathEscapesWorkingDir(String),
    /// The command was blank.
    #[error("the command is blank")]
    BlankCommand,
    /// The file operation failed.
    #[error("{path}: {error}")]
    Io {
        /// The path the operation named.
        path: String,
        /// The io error, rendered.
        error: String,
    },
    /// The program could not be started.
    #[error("could not start {command}: {error}")]
    Spawn {
        /// The program that was named.
        command: String,
        /// The io error, rendered.
        error: String,
    },
    /// The program was refused by the command execution policy.
    #[error("command `{command}` refused: {reason}")]
    CommandRefused {
        /// The program that was named.
        command: String,
        /// Why the policy refused it.
        reason: String,
    },
    /// The program timed out and was killed.
    #[error("command `{command}` timed out after {timeout_secs}s and was killed")]
    CommandTimedOut {
        /// The program that was named.
        command: String,
        /// The timeout in whole seconds.
        timeout_secs: u64,
    },
    /// The MCP call was denied.
    #[error("denied by MCP permission {server}::{tool}")]
    McpDenied { server: String, tool: String },
    /// The MCP call requires approval.
    #[error("approval required: {server}::{tool} is ask by default")]
    McpApprovalRequired { server: String, tool: String },
}

impl From<CommandPolicyError> for ToolError {
    fn from(error: CommandPolicyError) -> Self {
        match error {
            CommandPolicyError::BlankCommand => ToolError::BlankCommand,
            CommandPolicyError::Spawn { command, error } => ToolError::Spawn { command, error },
            CommandPolicyError::TimedOut { command, timeout } => ToolError::CommandTimedOut {
                command,
                timeout_secs: timeout.as_secs(),
            },
            CommandPolicyError::ShellRefused { command } => ToolError::CommandRefused {
                command,
                reason: "shell is refused unless explicitly allow-listed".to_string(),
            },
            CommandPolicyError::NotAllowed { command } => ToolError::CommandRefused {
                command,
                reason: "not in the allowed commands list".to_string(),
            },
            CommandPolicyError::ShellSyntax { command } => ToolError::CommandRefused {
                command,
                reason: "names shell syntax rather than a program".to_string(),
            },
            CommandPolicyError::ParentTraversal { command } => ToolError::CommandRefused {
                command,
                reason: "program path may not climb with `..`".to_string(),
            },
            CommandPolicyError::InvalidCommand { command, reason } => {
                ToolError::CommandRefused { command, reason }
            }
            CommandPolicyError::Wait { command, error } => ToolError::Spawn { command, error },
        }
    }
}

/// The seam Agent mode drives: one call in, one [`ToolResult`] out.
///
/// `Send + Sync` because the loop that holds it lives behind a lock in an async
/// daemon. `execute` is async so that long-running commands, file operations,
/// and external tools do not block worker threads.
#[async_trait]
pub trait ToolExecutor: Send + Sync {
    /// Run `tool` and describe what happened.
    async fn execute(&self, tool: &AgentTool) -> ToolResult;
}

/// The executor a loop holds before a caller wires one: it refuses every call and
/// says so, so a turn reports why nothing ran instead of pretending.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoToolExecutor;

#[async_trait]
impl ToolExecutor for NoToolExecutor {
    async fn execute(&self, tool: &AgentTool) -> ToolResult {
        ToolResult::failed(
            tool.clone(),
            format!(
                "no tool executor is wired into this agent loop, so {} did not run",
                tool.summary()
            ),
        )
    }
}

/// The real tool layer: files and commands, all inside one directory.
///
/// By default a write needs no prior read. [`FilesystemToolExecutor::with_read_before_write`]
/// installs a shared [`ReadBeforeWriteGuard`] so an unread file cannot be
/// overwritten; clones of the executor share the same guard.
use crate::mcp_approval::McpApprovals;
use crate::mcp_permission::MCP_AGENT_ROLE;
use serde_json::json;

#[derive(Debug, Clone)]
pub struct FilesystemToolExecutor {
    working_dir: PathBuf,
    /// `None` leaves writes unrestricted; `Some` enforces read-before-write.
    read_guard: Option<Arc<Mutex<ReadBeforeWriteGuard>>>,
    /// Command execution policy bounding `RunCommand` invocations.
    command_policy: CommandPolicy,
    /// Work-protection policy carried from the run's effective permissions (B2):
    /// `None` keeps today's behaviour; `Some` classifies every `RunCommand` and
    /// routes risky ones to the approval queue under ask-for-risky confinement.
    protection: Option<WorkProtectionPolicy>,
    /// Shared MCP approvals queue for native/MCP/bridge asks.
    mcp_approvals: Option<Arc<McpApprovals>>,
    /// Run ID for context in approvals.
    run_id: Option<String>,
}

impl PartialEq for FilesystemToolExecutor {
    /// Two executors are equal when they root at the same directory and agree on
    /// whether read-before-write is enforced and on command policy.
    fn eq(&self, other: &Self) -> bool {
        self.working_dir == other.working_dir
            && self.read_guard.is_some() == other.read_guard.is_some()
            && self.command_policy == other.command_policy
            && self.protection.is_some() == other.protection.is_some()
            && self.mcp_approvals.is_some() == other.mcp_approvals.is_some()
            && self.run_id == other.run_id
    }
}

impl Eq for FilesystemToolExecutor {}

impl FilesystemToolExecutor {
    /// An executor rooted at `working_dir`.
    ///
    /// Nothing is created or checked here, so construction cannot fail: the
    /// directory is made by the first write and a read or a command in a directory
    /// that does not exist reports an io or spawn failure.
    ///
    /// **Command execution fails closed**: a new executor carries
    /// [`CommandPolicy::deny_all`], so `RunCommand` refuses every program until a
    /// caller installs an allow-list with [`Self::with_command_policy`] (KEEL
    /// checkpoint finding L11). An executor built somewhere the configuration was
    /// not threaded through therefore runs nothing rather than the permissive
    /// [`CommandPolicy::default`] list; the daemon installs its configured list in
    /// exactly one place (`warshad::build_agent_loop`).
    pub fn new(working_dir: impl Into<PathBuf>) -> Self {
        Self {
            working_dir: working_dir.into(),
            read_guard: None,
            command_policy: CommandPolicy::deny_all(),
            protection: None,
            mcp_approvals: None,
            run_id: None,
        }
    }

    /// Attach the shared MCP approvals queue and run context.
    pub fn with_mcp_approvals(
        mut self,
        approvals: Arc<McpApprovals>,
        run_id: Option<String>,
    ) -> Self {
        self.mcp_approvals = Some(approvals);
        self.run_id = run_id;
        self
    }

    /// Install the work-protection policy this run resolved from its project
    /// permissions (B2). `None` keeps the executor out of the approval path.
    pub fn with_protection(mut self, policy: Option<WorkProtectionPolicy>) -> Self {
        self.protection = policy;
        self
    }

    /// The work-protection policy installed on this executor, if any.
    pub fn protection(&self) -> Option<&WorkProtectionPolicy> {
        self.protection.as_ref()
    }

    /// Set the command execution policy for `RunCommand` invocations.
    pub fn with_command_policy(mut self, policy: CommandPolicy) -> Self {
        self.command_policy = policy;
        self
    }

    /// The command execution policy installed on this executor.
    pub fn command_policy(&self) -> &CommandPolicy {
        &self.command_policy
    }

    /// Turn read-before-write enforcement on (`true`) or off (`false`).
    ///
    /// On installs a fresh enforcing [`ReadBeforeWriteGuard`]; off removes it, so
    /// writes need no prior read again. The guard is shared by every clone of this
    /// executor, so a read through one clone unlocks a write through another.
    /// Creating a file that does not exist is always allowed: only overwriting an
    /// existing, unread file is refused.
    pub fn with_read_before_write(mut self, enforce: bool) -> Self {
        self.read_guard = if enforce {
            Some(Arc::new(Mutex::new(ReadBeforeWriteGuard::new(true))))
        } else {
            None
        };
        self
    }

    /// The directory every path is resolved against.
    pub fn working_dir(&self) -> &Path {
        &self.working_dir
    }

    /// The absolute path `path` names, after the screen.
    ///
    /// Refused: a blank path, an absolute path, a Windows drive prefix, and any
    /// `..` component. `./notes.md` is allowed and resolves inside the directory.
    pub fn resolve(&self, path: &str) -> Result<PathBuf, ToolError> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(ToolError::BlankPath);
        }
        let candidate = Path::new(trimmed);
        let escapes = candidate.is_absolute()
            || candidate.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            });
        if escapes {
            return Err(ToolError::PathEscapesWorkingDir(trimmed.to_string()));
        }
        Ok(self.working_dir.join(candidate))
    }

    /// Resolve `path` for a write operation, ensuring it stays contained within
    /// the workspace and does not escape via symlinks.
    ///
    /// Refused:
    /// - Any path refused by [`Self::resolve`] (blank, absolute, `..`, drive prefix).
    /// - Any path whose final component is a symlink (including dangling links).
    /// - Any path that resolves outside the workspace root (via symlinked parent directories).
    /// - Any path whose deepest existing parent cannot be resolved or escapes the workspace.
    pub fn resolve_write_path(&self, path: &str) -> Result<PathBuf, ToolError> {
        let resolved = self.resolve(path)?;

        // The workspace root as the operating system sees it, so containment
        // checks compare resolved real paths.
        let canonical_root = self
            .working_dir
            .canonicalize()
            .map_err(|error| ToolError::Io {
                path: self.working_dir.display().to_string(),
                error: error.to_string(),
            })?;

        // Refuse if the final component is a symlink (including dangling links).
        if let Ok(meta) = std::fs::symlink_metadata(&resolved) {
            if meta.file_type().is_symlink() {
                return Err(ToolError::PathEscapesWorkingDir(path.to_string()));
            }
            let canonical_target = resolved
                .canonicalize()
                .map_err(|_| ToolError::PathEscapesWorkingDir(path.to_string()))?;
            if !canonical_target.starts_with(&canonical_root) {
                return Err(ToolError::PathEscapesWorkingDir(path.to_string()));
            }
            return Ok(resolved);
        }

        // Target does not exist: find the deepest existing parent.
        let mut deepest_existing = None;
        let mut current = resolved.parent();
        while let Some(parent) = current {
            match std::fs::symlink_metadata(parent) {
                Ok(meta) => {
                    deepest_existing = Some((parent, meta));
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    current = parent.parent();
                }
                Err(e) => {
                    return Err(ToolError::Io {
                        path: parent.display().to_string(),
                        error: e.to_string(),
                    });
                }
            }
        }

        let Some((existing_parent, _meta)) = deepest_existing else {
            return Err(ToolError::PathEscapesWorkingDir(path.to_string()));
        };

        // If the deepest existing parent is a dangling symlink or points outside,
        // canonicalize will fail or produce a path outside the workspace root.
        let canonical_parent = existing_parent
            .canonicalize()
            .map_err(|_| ToolError::PathEscapesWorkingDir(path.to_string()))?;

        if !canonical_parent.starts_with(&canonical_root) {
            return Err(ToolError::PathEscapesWorkingDir(path.to_string()));
        }

        Ok(resolved)
    }

    /// The resolved absolute path with `.` components normalised away, so
    /// `notes.md` and `./notes.md` name the same file. An invalid path carries the
    /// same refusal the read/write itself would report.
    fn resolved_guard_path(&self, path: &str) -> Result<PathBuf, String> {
        self.resolve(path)
            .map(|resolved| resolved.components().collect())
            .map_err(|error| error.to_string())
    }

    /// The shared key both guard calls use for `path`, derived from
    /// [`Self::resolved_guard_path`] so the guard and the existence check agree.
    fn guard_key(&self, path: &str) -> Result<String, String> {
        self.resolved_guard_path(path)
            .map(|normalized| normalized.display().to_string())
    }

    /// Whether a write to `path` is allowed. No guard means always allowed; a
    /// poisoned mutex is a refusal, never a panic.
    ///
    /// A genuine create is always allowed: a file that does not exist can never
    /// have been read. The existence check runs on the same resolved path the
    /// guard keys on, so `./notes.md` and `notes.md` agree. A file that does
    /// exist still needs a prior read.
    fn write_allowed(&self, path: &str) -> Result<bool, String> {
        let Some(guard) = &self.read_guard else {
            return Ok(true);
        };
        let resolved = self.resolved_guard_path(path)?;
        let guard = guard
            .lock()
            .map_err(|_| "the read-before-write guard is poisoned".to_string())?;
        if !resolved.exists() {
            return Ok(true);
        }
        Ok(guard.may_write(&resolved.display().to_string()))
    }

    /// Record a successful read of `path` with the guard, if one is installed. A
    /// poisoned mutex is reported as an error rather than panicking.
    fn note_read(&self, path: &str) -> Result<(), String> {
        let Some(guard) = &self.read_guard else {
            return Ok(());
        };
        let key = self.guard_key(path)?;
        let mut guard = guard
            .lock()
            .map_err(|_| "the read-before-write guard is poisoned".to_string())?;
        guard.record_read(&key);
        Ok(())
    }

    /// Read a text file. A missing file is a failed result, not a refusal.
    fn read_file(&self, path: &str) -> Result<ToolResult, ToolError> {
        let tool = AgentTool::ReadFile {
            path: path.to_string(),
        };
        let resolved = self.resolve(path)?;
        match std::fs::read_to_string(&resolved) {
            Ok(content) => Ok(ToolResult::ok(tool, content)),
            Err(error) => Ok(ToolResult::failed(
                tool,
                format!("could not read {}: {error}", resolved.display()),
            )),
        }
    }

    /// Write a text file, creating the parent directories it needs.
    fn write_file(&self, path: &str, content: &str) -> Result<ToolResult, ToolError> {
        let tool = AgentTool::WriteFile {
            path: path.to_string(),
            content: content.to_string(),
        };
        let resolved = self.resolve_write_path(path)?;
        // B2: read-only confinement refuses every write by name.
        if let Some(policy) = &self.protection {
            if policy.mode == PermissionMode::ReadOnly {
                return Ok(ToolResult::failed(
                    tool,
                    format!(
                        "writes are refused under read-only permissions ({})",
                        resolved.display()
                    ),
                ));
            }
        }
        if let Some(parent) = resolved.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                return Ok(ToolResult::failed(
                    tool,
                    format!("could not create {}: {error}", parent.display()),
                ));
            }
        }
        // Defense-in-depth: re-check that the target component has not become a symlink.
        if let Ok(meta) = std::fs::symlink_metadata(&resolved) {
            if meta.file_type().is_symlink() {
                return Err(ToolError::PathEscapesWorkingDir(path.to_string()));
            }
        }
        match std::fs::write(&resolved, content) {
            Ok(()) => Ok(ToolResult::ok(
                tool,
                format!("wrote {} bytes to {}", content.len(), resolved.display()),
            )),
            Err(error) => Ok(ToolResult::failed(
                tool,
                format!("could not write {}: {error}", resolved.display()),
            )),
        }
    }

    /// Run a program in the working directory under the command execution policy.
    ///
    /// B2: the command allowlist stays the hard floor — a program outside the
    /// policy is refused, never asked. When a work-protection policy is installed
    /// and the command classifies risky (shell, network, publish/push, paths
    /// outside the workspace), the ask-for-risky mode routes it to the approval
    /// queue instead of running it; never-ask (auto-inside-project) runs it only
    /// when safe. Read-only confinement refuses every command by name.
    ///
    /// B3: an ask-mode refusal registers a pending entry on the shared queue
    /// (the same one MCP and bridge asks use) so the owner sees the native ask
    /// with the tool, exact arguments, role, and run — and the refusal text
    /// points at the queue either way.
    async fn run_command(&self, command: &str, args: &[String]) -> Result<ToolResult, ToolError> {
        let tool = AgentTool::RunCommand {
            command: command.to_string(),
            args: args.to_vec(),
        };
        let (program, effective_args) =
            crate::command_policy::resolve_program_and_args(command, args)?;
        if let Some(policy) = &self.protection {
            match policy.mode {
                PermissionMode::FullAccess => {}
                PermissionMode::AutoInsideProject => {
                    if classify_command(&program, &effective_args) == RiskClass::Risky {
                        return Err(ToolError::CommandRefused {
                            command: format!("{command} {}", args.join(" ")),
                            reason:
                                "risky command under never-ask permissions; the owner must allow it"
                                    .into(),
                        });
                    }
                }
                PermissionMode::ReadOnly => {
                    return Err(ToolError::CommandRefused {
                        command: format!("{command} {}", args.join(" ")),
                        reason: "commands are refused under read-only permissions".into(),
                    });
                }
                PermissionMode::AskAlways | PermissionMode::AskForRisky => {
                    let risky = classify_command(&program, &effective_args) == RiskClass::Risky;
                    if risky || policy.mode == PermissionMode::AskAlways {
                        let command_line = format!("{command} {}", args.join(" "));
                        // One shared ask-queue (B3): register the native ask so
                        // the owner's approval UI shows it beside MCP asks.
                        if let (Some(approvals), Some(run_id)) = (&self.mcp_approvals, &self.run_id)
                        {
                            let summary = format!("run the command `{command_line}`");
                            match approvals.register_pending(
                                run_id,
                                "native",
                                "run_command",
                                MCP_AGENT_ROLE,
                                &json!({ "command": program, "args": effective_args }),
                                summary,
                            ) {
                                Ok(_question_id) => {}
                                Err(error) => {
                                    // The queue refused (cap, dedupe, persistence):
                                    // fail closed — the ask cannot be answered, so
                                    // the command is refused, never run.
                                    return Err(ToolError::CommandRefused {
                                        command: command_line,
                                        reason: format!(
                                            "the approval queue refused the ask: {error}"
                                        ),
                                    });
                                }
                            }
                        }
                        return Err(ToolError::CommandRefused {
                            command: command_line,
                            reason: "this command needs the owner's approval under the project's permission settings; ask via the approval queue".into(),
                        });
                    }
                }
            }
        }
        let output = self
            .command_policy
            .execute_resolved(&program, &effective_args, &self.working_dir)
            .await?;
        Ok(ToolResult::new(tool, output.success, output.format_text()))
    }
}

#[async_trait]
impl ToolExecutor for FilesystemToolExecutor {
    async fn execute(&self, tool: &AgentTool) -> ToolResult {
        // Read-before-write: refuse a write to an unread path before any file is
        // touched. With no guard installed this is always allowed.
        if let AgentTool::WriteFile { path, .. } = tool {
            match self.write_allowed(path) {
                Ok(true) => {}
                Ok(false) => {
                    return ToolResult::failed(
                        tool.clone(),
                        format!("read-before-write: {path} must be read before it is written"),
                    );
                }
                Err(message) => return ToolResult::failed(tool.clone(), message),
            }
        }

        let outcome = match tool {
            AgentTool::ReadFile { path } => self.read_file(path),
            AgentTool::WriteFile { path, content } => self.write_file(path, content),
            AgentTool::RunCommand { command, args } => self.run_command(command, args).await,
            AgentTool::CallTool { .. } => {
                return ToolResult::failed(
                    tool.clone(),
                    "call_tool is handled by the agent loop via McpManager",
                );
            }
        };
        let result = match outcome {
            Ok(result) => result,
            Err(error) => return ToolResult::failed(tool.clone(), error.to_string()),
        };

        // A successful read unlocks a later write to the same path.
        if let AgentTool::ReadFile { path } = tool {
            if result.success {
                if let Err(message) = self.note_read(path) {
                    return ToolResult::failed(tool.clone(), message);
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::fresh_tempdir;

    /// A program plus arguments that print `hello` on this platform.
    ///
    /// `echo` is a shell builtin on Windows and a binary on Unix, so the two are
    /// spelled through their shells — the same shape `warshad`'s process tests use.
    fn printing_command() -> (String, Vec<String>) {
        #[cfg(windows)]
        {
            (
                "cmd".to_string(),
                vec!["/C".to_string(), "echo hello".to_string()],
            )
        }
        #[cfg(not(windows))]
        {
            (
                "sh".to_string(),
                vec!["-c".to_string(), "echo hello".to_string()],
            )
        }
    }

    /// A command that exits with a non-zero code.
    fn failing_command() -> (String, Vec<String>) {
        #[cfg(windows)]
        {
            (
                "cmd".to_string(),
                vec!["/C".to_string(), "echo boom 1>&2 & exit 3".to_string()],
            )
        }
        #[cfg(not(windows))]
        {
            (
                "sh".to_string(),
                vec!["-c".to_string(), "echo boom 1>&2; exit 3".to_string()],
            )
        }
    }

    fn executor(dir: &Path) -> FilesystemToolExecutor {
        FilesystemToolExecutor::new(dir)
    }

    fn shell_executor(dir: &Path) -> FilesystemToolExecutor {
        FilesystemToolExecutor::new(dir).with_command_policy(CommandPolicy::from_config(&[
            "cmd".to_string(),
            "sh".to_string(),
        ]))
    }

    #[tokio::test]
    async fn a_read_file_tool_returns_the_file_content() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "first\nsecond\n")
            .expect("the file is written");

        let result = executor(temp.path())
            .execute(&AgentTool::ReadFile {
                path: "notes.md".to_string(),
            })
            .await;

        assert!(result.success, "unexpected result: {result:?}");
        assert_eq!(result.output, "first\nsecond\n");
        assert_eq!(result.tool.summary(), "read_file notes.md");
        assert_eq!(result.status(), "ok");
    }

    #[tokio::test]
    async fn a_write_file_tool_writes_the_content() {
        let temp = fresh_tempdir();

        let result = executor(temp.path())
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "hello from the agent\n".to_string(),
            })
            .await;

        assert!(result.success, "unexpected result: {result:?}");
        assert!(result.output.starts_with("wrote 21 bytes to "));
        assert_eq!(
            std::fs::read_to_string(temp.path().join("notes.md")).expect("the file is readable"),
            "hello from the agent\n"
        );
    }

    #[tokio::test]
    async fn a_write_file_tool_creates_the_parent_directories() {
        let temp = fresh_tempdir();

        let result = executor(temp.path())
            .execute(&AgentTool::WriteFile {
                path: "factory/runs/turn-1/notes.md".to_string(),
                content: "nested".to_string(),
            })
            .await;

        assert!(result.success, "unexpected result: {result:?}");
        let written = temp.path().join("factory/runs/turn-1/notes.md");
        assert!(written.is_file(), "{} was not created", written.display());
        assert_eq!(
            std::fs::read_to_string(&written).expect("the file is readable"),
            "nested"
        );
    }

    #[tokio::test]
    async fn a_read_of_a_missing_file_is_a_failed_result() {
        let temp = fresh_tempdir();

        let result = executor(temp.path())
            .execute(&AgentTool::ReadFile {
                path: "missing.md".to_string(),
            })
            .await;

        assert!(!result.success);
        assert_eq!(result.status(), "failed");
        assert!(
            result.output.starts_with("could not read "),
            "unexpected output: {}",
            result.output
        );
        assert!(result.output.contains("missing.md"));
    }

    #[tokio::test]
    async fn a_run_command_tool_runs_the_command_in_the_working_directory() {
        let temp = fresh_tempdir();
        let (command, args) = printing_command();

        let result = shell_executor(temp.path())
            .execute(&AgentTool::RunCommand { command, args })
            .await;

        assert!(result.success, "unexpected result: {result:?}");
        assert!(
            result.output.contains("hello"),
            "unexpected output: {}",
            result.output
        );
        assert!(
            result.output.contains("exit code: 0"),
            "unexpected output: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn a_run_command_tool_reports_a_non_zero_exit_as_a_failed_result() {
        let temp = fresh_tempdir();
        let (command, args) = failing_command();

        let result = shell_executor(temp.path())
            .execute(&AgentTool::RunCommand { command, args })
            .await;

        assert!(!result.success);
        // Both streams and the code are in the output: the command ran and failed.
        assert!(
            result.output.contains("boom"),
            "unexpected output: {}",
            result.output
        );
        assert!(
            result.output.contains("exit code: 3"),
            "unexpected output: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn a_missing_program_is_a_refusal() {
        let temp = fresh_tempdir();
        let exec = executor(temp.path()).with_command_policy(CommandPolicy::from_config(&[
            "warsha-no-such-program".to_string(),
        ]));

        let result = exec
            .execute(&AgentTool::RunCommand {
                command: "warsha-no-such-program".to_string(),
                args: Vec::new(),
            })
            .await;

        assert!(!result.success);
        assert!(
            result
                .output
                .starts_with("could not start warsha-no-such-program"),
            "unexpected output: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn an_allowlisted_executor_refuses_shells_and_unlisted_commands() {
        let temp = fresh_tempdir();
        // The executor's `new` is deny-all (see
        // `a_new_executor_denies_every_command_until_an_allowlist_is_installed`), so a
        // policy that admits a toolchain but no shell is installed explicitly: that is
        // what makes a shell refusal `ShellRefused` rather than merely unlisted.
        let exec = executor(temp.path())
            .with_command_policy(CommandPolicy::from_config(&["cargo".to_string()]));

        for shell in ["sh", "bash", "cmd", "powershell", "pwsh"] {
            let result = exec
                .execute(&AgentTool::RunCommand {
                    command: shell.to_string(),
                    args: vec!["--help".to_string()],
                })
                .await;
            assert!(!result.success, "shell `{shell}` was not refused");
            assert!(
                result.output.contains("refused") && result.output.contains("shell"),
                "unexpected shell refusal for `{shell}`: {}",
                result.output
            );
        }

        let unlisted = exec
            .execute(&AgentTool::RunCommand {
                command: "rm -rf /".to_string(),
                args: Vec::new(),
            })
            .await;
        assert!(!unlisted.success);
        assert!(
            unlisted.output.contains("not in the allowed commands list"),
            "unexpected output: {}",
            unlisted.output
        );
    }

    /// R-KEEL row 11: a fresh executor is fail-closed, so an executor built without
    /// the daemon's configuration runs nothing instead of the permissive default
    /// list. The programs checked are `DEFAULT_ALLOWED_COMMANDS` entries, i.e. what
    /// a default-allowed executor would have run.
    #[tokio::test]
    async fn a_new_executor_denies_every_command_until_an_allowlist_is_installed() {
        let temp = fresh_tempdir();
        let denied = executor(temp.path());

        assert!(
            denied.command_policy().allowed().is_empty(),
            "a new executor installed an allow-list: {:?}",
            denied.command_policy().allowed()
        );
        for program in ["cargo", "npm", "git"] {
            assert!(
                matches!(
                    denied.command_policy().check_program(program),
                    Err(CommandPolicyError::NotAllowed { .. })
                ),
                "`{program}` was not refused by the default policy"
            );
            let result = denied
                .execute(&AgentTool::RunCommand {
                    command: program.to_string(),
                    args: vec!["--version".to_string()],
                })
                .await;
            assert!(!result.success, "`{program}` ran on a default executor");
            assert!(
                result.output.contains("not in the allowed commands list"),
                "unexpected refusal for `{program}`: {}",
                result.output
            );
        }

        // The explicit list is what opens the door, and only for its own entries.
        let allowed = executor(temp.path())
            .with_command_policy(CommandPolicy::from_config(&["cargo".to_string()]));
        assert!(allowed.command_policy().check_program("cargo").is_ok());
        assert!(matches!(
            allowed.command_policy().check_program("npm"),
            Err(CommandPolicyError::NotAllowed { .. })
        ));
    }

    #[tokio::test]
    async fn a_path_outside_the_working_directory_is_refused() {
        let temp = fresh_tempdir();
        // The workspace is one directory inside the temporary one, so the file an
        // escaping write would reach is known to be absent before the attempt.
        let workspace = temp.path().join("work");
        std::fs::create_dir_all(&workspace).expect("the workspace is made");
        let escape_target = temp.path().join("escape.md");
        let executor = executor(&workspace);

        for path in ["../escape.md", "nested/../../escape.md", "/etc/passwd"] {
            let error = executor
                .resolve(path)
                .expect_err("an escaping path is refused");
            assert_eq!(error, ToolError::PathEscapesWorkingDir(path.to_string()));
        }

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "../escape.md".to_string(),
                content: "no".to_string(),
            })
            .await;
        assert!(!result.success);
        assert!(result
            .output
            .contains("must stay inside the working directory"));
        assert!(
            !escape_target.exists(),
            "{} was written",
            escape_target.display()
        );
    }

    #[tokio::test]
    async fn symlink_to_parent_dir_is_refused() {
        let temp = fresh_tempdir();
        let workspace = temp.path().join("work");
        std::fs::create_dir_all(&workspace).expect("workspace made");
        let executor = executor(&workspace);
        let link_path = workspace.join("link_to_parent");

        #[cfg(unix)]
        std::os::unix::fs::symlink("..", &link_path).expect("link created");

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "link_to_parent/escape.md".to_string(),
                content: "bad".to_string(),
            })
            .await;
        assert!(!result.success, "Write should fail");
    }

    #[tokio::test]
    async fn symlink_to_etc_is_refused() {
        let temp = fresh_tempdir();
        let workspace = temp.path().join("work");
        std::fs::create_dir_all(&workspace).expect("workspace made");
        let executor = executor(&workspace);
        let link_path = workspace.join("link_to_etc");

        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc", &link_path).expect("link created");

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "link_to_etc/passwd".to_string(),
                content: "bad".to_string(),
            })
            .await;
        assert!(!result.success, "Write should fail");
    }

    #[tokio::test]
    async fn dangling_symlink_is_refused() {
        let temp = fresh_tempdir();
        let workspace = temp.path().join("work");
        std::fs::create_dir_all(&workspace).expect("workspace made");
        let executor = executor(&workspace);
        let link_path = workspace.join("dangling_link");

        #[cfg(unix)]
        std::os::unix::fs::symlink("/tmp/nonexistent", &link_path).expect("link created");

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "dangling_link/file.txt".to_string(),
                content: "bad".to_string(),
            })
            .await;
        assert!(!result.success, "Write should fail");
    }

    #[tokio::test]
    async fn normal_nested_paths_still_work() {
        let temp = fresh_tempdir();
        let workspace = temp.path().join("work");
        std::fs::create_dir_all(&workspace).expect("workspace made");
        let executor = executor(&workspace);

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "nested/dir/file.txt".to_string(),
                content: "good".to_string(),
            })
            .await;
        assert!(result.success, "Write should succeed");
        assert!(workspace.join("nested/dir/file.txt").exists());
    }

    #[tokio::test]
    async fn a_blank_path_and_a_blank_command_are_refused() {
        let temp = fresh_tempdir();
        let executor = executor(temp.path());

        assert_eq!(executor.resolve("   "), Err(ToolError::BlankPath));
        let read = executor
            .execute(&AgentTool::ReadFile {
                path: " ".to_string(),
            })
            .await;
        assert!(!read.success);
        assert_eq!(read.output, "the path is blank");

        let run = executor
            .execute(&AgentTool::RunCommand {
                command: "  ".to_string(),
                args: Vec::new(),
            })
            .await;
        assert!(!run.success);
        assert_eq!(run.output, "the command is blank");
    }

    #[test]
    fn a_dotted_path_resolves_inside_the_working_directory() {
        let temp = fresh_tempdir();
        let executor = executor(temp.path());

        let resolved = executor
            .resolve("./notes.md")
            .expect("a dotted relative path is allowed");
        assert!(resolved.starts_with(temp.path()));
        assert_eq!(executor.working_dir(), temp.path());
    }

    #[tokio::test]
    async fn the_no_tool_executor_refuses_every_tool() {
        let tool = AgentTool::WriteFile {
            path: "notes.md".to_string(),
            content: "no".to_string(),
        };

        let result = NoToolExecutor.execute(&tool).await;

        assert!(!result.success);
        assert_eq!(result.tool, tool);
        assert_eq!(
            result.output,
            "no tool executor is wired into this agent loop, so write_file notes.md did not run"
        );
    }

    #[test]
    fn a_tool_and_a_result_use_snake_case_on_the_wire() {
        let tool = AgentTool::RunCommand {
            command: "cargo".to_string(),
            args: vec!["test".to_string()],
        };
        let wire = serde_json::to_value(&tool).expect("a tool serializes");
        assert_eq!(wire["tool"], serde_json::json!("run_command"));
        assert_eq!(wire["args"][0], serde_json::json!("test"));

        let result = ToolResult::ok(tool, "all good");
        let wire = serde_json::to_value(&result).expect("a result serializes");
        assert_eq!(wire["success"], serde_json::json!(true));
        assert_eq!(wire["tool"]["tool"], serde_json::json!("run_command"));
        assert_eq!(wire["output"], serde_json::json!("all good"));

        // The same shape parses back, which is what a transcript does.
        let parsed: ToolResult = serde_json::from_value(wire).expect("a result parses");
        assert!(parsed.success);
        assert_eq!(parsed.status(), "ok");
    }

    #[tokio::test]
    async fn the_default_executor_writes_without_a_prior_read() {
        let temp = fresh_tempdir();
        let executor = executor(temp.path());

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "no read needed".to_string(),
            })
            .await;

        assert!(result.success, "unexpected result: {result:?}");
        assert!(temp.path().join("notes.md").is_file());
    }

    #[tokio::test]
    async fn an_enforced_executor_refuses_an_unread_write_and_writes_nothing() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "original").expect("the file is written");
        let executor = executor(temp.path()).with_read_before_write(true);

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "should not land".to_string(),
            })
            .await;

        assert!(!result.success);
        assert!(
            result.output.contains("read-before-write"),
            "unexpected output: {}",
            result.output
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("notes.md")).expect("the file is readable"),
            "original",
            "the unread write clobbered the file"
        );
    }

    #[tokio::test]
    async fn an_enforced_executor_creates_a_missing_file_without_a_prior_read() {
        let temp = fresh_tempdir();
        let executor = executor(temp.path()).with_read_before_write(true);

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "a genuine create".to_string(),
            })
            .await;

        assert!(result.success, "the create was refused: {result:?}");
        assert_eq!(
            std::fs::read_to_string(temp.path().join("notes.md")).expect("the file is readable"),
            "a genuine create"
        );

        // The dotted form resolves to the same missing file: still a create.
        let dotted = executor
            .execute(&AgentTool::WriteFile {
                path: "./drafts/./plan.md".to_string(),
                content: "nested create".to_string(),
            })
            .await;
        assert!(dotted.success, "the dotted create was refused: {dotted:?}");
        assert_eq!(
            std::fs::read_to_string(temp.path().join("drafts/plan.md"))
                .expect("the file is readable"),
            "nested create"
        );
    }

    #[tokio::test]
    async fn an_enforced_executor_refuses_an_unread_overwrite_via_the_dotted_path() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "original").expect("the file is written");
        let executor = executor(temp.path()).with_read_before_write(true);

        // The file exists; the dotted spelling must not read as a create.
        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "./notes.md".to_string(),
                content: "should not land".to_string(),
            })
            .await;

        assert!(
            !result.success,
            "the dotted overwrite was allowed: {result:?}"
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("notes.md")).expect("the file is readable"),
            "original"
        );
    }

    #[tokio::test]
    async fn a_disabled_executor_overwrites_an_unread_file() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "original").expect("the file is written");
        let executor = executor(temp.path()).with_read_before_write(false);

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "replaced without a read".to_string(),
            })
            .await;

        assert!(result.success, "unexpected result: {result:?}");
        assert_eq!(
            std::fs::read_to_string(temp.path().join("notes.md")).expect("the file is readable"),
            "replaced without a read"
        );
    }

    #[tokio::test]
    async fn an_enforced_executor_allows_a_read_then_write() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "original").expect("the file is written");
        let executor = executor(temp.path()).with_read_before_write(true);

        let read = executor
            .execute(&AgentTool::ReadFile {
                path: "notes.md".to_string(),
            })
            .await;
        assert!(read.success, "unexpected read: {read:?}");

        let write = executor
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "updated".to_string(),
            })
            .await;
        assert!(write.success, "the read-then-write was refused: {write:?}");
        assert_eq!(
            std::fs::read_to_string(temp.path().join("notes.md")).expect("the file is readable"),
            "updated"
        );
    }

    #[tokio::test]
    async fn clones_share_the_read_before_write_guard() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "original").expect("the file is written");
        let executor = executor(temp.path()).with_read_before_write(true);
        let clone = executor.clone();

        // Read through the original; the clone must see that read.
        let read = executor
            .execute(&AgentTool::ReadFile {
                path: "notes.md".to_string(),
            })
            .await;
        assert!(read.success);

        let write = clone
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "updated".to_string(),
            })
            .await;
        assert!(
            write.success,
            "the clone did not share the guard: {write:?}"
        );
    }

    #[tokio::test]
    async fn the_guard_normalises_paths_relative_to_the_working_dir() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "original").expect("the file is written");
        let executor = executor(temp.path()).with_read_before_write(true);

        // Read via the dotted form, write via the plain form: the same file.
        let read = executor
            .execute(&AgentTool::ReadFile {
                path: "./notes.md".to_string(),
            })
            .await;
        assert!(read.success);

        let write = executor
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "updated".to_string(),
            })
            .await;
        assert!(write.success, "normalisation mismatch: {write:?}");
    }

    #[tokio::test]
    async fn turning_enforcement_off_restores_unrestricted_writes() {
        let temp = fresh_tempdir();
        let executor = executor(temp.path())
            .with_read_before_write(true)
            .with_read_before_write(false);

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "no read needed".to_string(),
            })
            .await;

        assert!(result.success, "unexpected result: {result:?}");
    }

    #[test]
    fn executor_equality_compares_the_working_dir_and_enforcement() {
        let temp = fresh_tempdir();
        let plain = executor(temp.path());
        let enforced = executor(temp.path()).with_read_before_write(true);

        assert_eq!(plain, executor(temp.path()));
        // Two separately-built enforcing executors are equal: enforcement state,
        // not guard identity, is what compares.
        assert_eq!(enforced, executor(temp.path()).with_read_before_write(true));
        assert_ne!(plain, enforced);
    }

    #[tokio::test]
    async fn a_poisoned_guard_fails_the_call_instead_of_panicking() {
        let temp = fresh_tempdir();
        let executor = executor(temp.path()).with_read_before_write(true);
        let guard = executor.read_guard.as_ref().expect("a guard is installed");
        let shared = Arc::clone(guard);

        // Poison the mutex by panicking while holding its lock.
        let handle = std::thread::spawn(move || {
            let _lock = shared.lock().expect("the lock is taken before the panic");
            panic!("poison the guard");
        });
        assert!(handle.join().is_err(), "the thread did not panic");

        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "should not land".to_string(),
            })
            .await;
        assert!(!result.success);
        assert!(
            result.output.contains("poisoned"),
            "unexpected output: {}",
            result.output
        );
        assert!(!temp.path().join("notes.md").exists());
    }

    #[test]
    fn mcp_error_variants_are_byte_identical_to_the_strings_they_replace() {
        assert_eq!(
            ToolError::McpDenied {
                server: "files".to_string(),
                tool: "write".to_string()
            }
            .to_string(),
            "denied by MCP permission files::write"
        );
        assert_eq!(
            ToolError::McpApprovalRequired {
                server: "files".to_string(),
                tool: "write".to_string()
            }
            .to_string(),
            "approval required: files::write is ask by default"
        );
    }
}

#[cfg(test)]
mod protection_tests {
    use super::*;

    fn executor_with(policy: Option<WorkProtectionPolicy>) -> FilesystemToolExecutor {
        FilesystemToolExecutor::new("/tmp/b2-test")
            .with_command_policy(CommandPolicy::from_config(&[
                "git".to_string(),
                "bash".to_string(),
            ]))
            .with_protection(policy)
    }

    fn policy(mode: PermissionMode) -> Option<WorkProtectionPolicy> {
        Some(WorkProtectionPolicy {
            mode,
            snapshot_before_edit: false,
            worktree_isolation: false,
            read_before_write: false,
        })
    }

    #[tokio::test]
    async fn read_only_refuses_writes_by_name() {
        let dir = std::env::temp_dir().join("b2-readonly-test");
        let _ = std::fs::create_dir_all(&dir);
        let executor = FilesystemToolExecutor::new(&dir).with_protection(policy(
            PermissionMode::ReadOnly, // read-only confinement refuses every write
        ));
        let result = executor
            .execute(&AgentTool::WriteFile {
                path: "new.txt".to_string(),
                content: "x".to_string(),
            })
            .await;
        assert!(
            !result.success,
            "read-only confinement must refuse workspace writes"
        );
        assert!(
            result.output.contains("read-only permissions"),
            "refusal names the confinement: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn risky_command_under_ask_for_risky_is_refused() {
        let executor = executor_with(policy(PermissionMode::AskForRisky));
        let result = executor
            .execute(&AgentTool::RunCommand {
                command: "bash".to_string(),
                args: vec!["-c".to_string(), "echo hi".to_string()],
            })
            .await;
        assert!(
            !result.success,
            "risky command must be refused under ask-for-risky"
        );
        assert!(
            result.output.contains("approval"),
            "refusal must name the approval path, got: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn safe_command_under_ask_for_risky_runs() {
        let dir = std::env::temp_dir().join("b2-safe-test");
        let _ = std::fs::create_dir_all(&dir);
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&["git".to_string()]))
            .with_protection(policy(PermissionMode::AskForRisky));
        let result = executor
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec!["status".to_string()],
            })
            .await;
        // git status is safe: it runs (its success depends on the dir, but it must not be refused by the protection layer)
        assert!(
            result.success
                || result.output.contains("fatal")
                || result.output.contains("not a git repository")
                || !result.output.contains("approval"),
            "safe command must not be refused by the protection layer, got: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn risky_command_under_never_ask_is_refused() {
        let executor = executor_with(policy(PermissionMode::AutoInsideProject));
        let result = executor
            .execute(&AgentTool::RunCommand {
                command: "bash".to_string(),
                args: vec![],
            })
            .await;
        assert!(
            !result.success,
            "risky command must be refused under never-ask"
        );
    }

    #[tokio::test]
    async fn full_access_runs_everything_the_policy_allows() {
        let executor = executor_with(policy(PermissionMode::FullAccess));
        let result = executor
            .execute(&AgentTool::RunCommand {
                command: "bash".to_string(),
                args: vec![],
            })
            .await;
        // Full access skips the protection layer entirely; the command policy still applies
        // (bash is in the test config), so the result must not be a protection refusal.
        assert!(
            !result.output.contains("approval") && !result.output.contains("never-ask"),
            "full access must not consult the protection layer, got: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn no_protection_keeps_today_behaviour() {
        let executor = executor_with(None);
        let result = executor
            .execute(&AgentTool::RunCommand {
                command: "bash".to_string(),
                args: vec![],
            })
            .await;
        assert!(
            !result.output.contains("approval"),
            "no policy must keep the old behaviour, got: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn risky_command_under_ask_registers_on_the_shared_queue() {
        let approvals = Arc::new(McpApprovals::new(None));
        let dir = std::env::temp_dir().join("b3-queue-test");
        let _ = std::fs::create_dir_all(&dir);
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&["git".to_string()]))
            .with_protection(policy(PermissionMode::AskForRisky))
            .with_mcp_approvals(approvals.clone(), Some("run-b3-1".to_string()));
        let result = executor
            .execute(&AgentTool::RunCommand {
                command: "bash".to_string(),
                args: vec!["-c".to_string(), "echo hi".to_string()],
            })
            .await;
        assert!(
            !result.success,
            "the ask-mode refusal still refuses the command"
        );
        let pending = approvals.pending();
        assert_eq!(
            pending.len(),
            1,
            "the native ask must register on the shared queue"
        );
        assert_eq!(pending[0].server, "native");
        assert_eq!(pending[0].tool, "run_command");
        assert_eq!(pending[0].run_id, "run-b3-1");
        assert_eq!(pending[0].role, "agent");
    }

    #[tokio::test]
    async fn ask_without_a_run_id_never_registers() {
        let approvals = Arc::new(McpApprovals::new(None));
        let dir = std::env::temp_dir().join("b3-norun-test");
        let _ = std::fs::create_dir_all(&dir);
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&["git".to_string()]))
            .with_protection(policy(PermissionMode::AskAlways))
            .with_mcp_approvals(approvals.clone(), None);
        let result = executor
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec!["push".to_string()],
            })
            .await;
        assert!(!result.success);
        assert!(
            approvals.pending().is_empty(),
            "a daemon-wide loop (no run id) must never register a pending ask"
        );
    }

    #[tokio::test]
    async fn bypass_tests_git_push_compound() {
        let dir = std::env::temp_dir().join("b5-bypass-test-1");
        let _ = std::fs::create_dir_all(&dir);

        let approvals = Arc::new(McpApprovals::new(None));
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&[
                "git".to_string(),
                "npm".to_string(),
            ]))
            .with_protection(policy(PermissionMode::AskForRisky))
            .with_mcp_approvals(approvals.clone(), Some("run-b5-1".to_string()));
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "git push origin main".to_string(),
                args: vec![],
            })
            .await;
        assert!(!res.success, "git push origin main should be refused");
        assert_eq!(approvals.pending().len(), 1);
    }

    #[tokio::test]
    async fn bypass_tests_usr_bin_git_path() {
        let dir = std::env::temp_dir().join("b5-bypass-test-2");
        let _ = std::fs::create_dir_all(&dir);

        let approvals = Arc::new(McpApprovals::new(None));
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&[
                "git".to_string(),
                "npm".to_string(),
            ]))
            .with_protection(policy(PermissionMode::AskForRisky))
            .with_mcp_approvals(approvals.clone(), Some("run-b5-2".to_string()));
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "/usr/bin/git".to_string(),
                args: vec!["push".to_string()],
            })
            .await;
        assert!(!res.success, "/usr/bin/git push should be refused");
        assert_eq!(approvals.pending().len(), 1);
    }

    #[tokio::test]
    async fn bypass_tests_npm_publish_compound() {
        let dir = std::env::temp_dir().join("b5-bypass-test-3");
        let _ = std::fs::create_dir_all(&dir);

        let approvals = Arc::new(McpApprovals::new(None));
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&[
                "git".to_string(),
                "npm".to_string(),
            ]))
            .with_protection(policy(PermissionMode::AskForRisky))
            .with_mcp_approvals(approvals.clone(), Some("run-b5-3".to_string()));
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "npm publish".to_string(),
                args: vec![],
            })
            .await;
        assert!(!res.success, "npm publish should be refused");
        assert_eq!(approvals.pending().len(), 1);
    }

    #[tokio::test]
    async fn bypass_tests_quoted_git_exe() {
        let dir = std::env::temp_dir().join("b5-bypass-test-4");
        let _ = std::fs::create_dir_all(&dir);

        let approvals = Arc::new(McpApprovals::new(None));
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&[
                "git".to_string(),
                "npm".to_string(),
            ]))
            .with_protection(policy(PermissionMode::AskForRisky))
            .with_mcp_approvals(approvals.clone(), Some("run-b5-4".to_string()));
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "\"git.exe\"".to_string(),
                args: vec!["push".to_string()],
            })
            .await;
        assert!(!res.success, "git.exe push should be refused");
        assert_eq!(approvals.pending().len(), 1);
    }
}
