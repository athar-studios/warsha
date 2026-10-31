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
//! A command runs through `std::process::Command` with the working directory as
//! its `current_dir`, and a non-zero exit is a *result* (`success: false`, with
//! stdout, stderr and the code in the output) rather than an error: the command
//! ran and failed, which is what a loop needs to read. Two limits are deliberate.
//! There is no timeout — `output()` waits for the child to exit, so the caller's
//! thread is busy for as long as the command runs, and the daemon's `process.*`
//! spawner stays the timeout-capable path — and a command line is split on
//! whitespace only, with no shell, no quoting and no expansion.

use std::path::{Component, Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use thiserror::Error;

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
}

/// The seam Agent mode drives: one call in, one [`ToolResult`] out.
///
/// `Send + Sync` because the loop that holds it lives behind a lock in an async
/// daemon. `execute` is synchronous — a file read and a short command are — so an
/// implementation must not park on anything a caller cannot interrupt.
pub trait ToolExecutor: Send + Sync {
    /// Run `tool` and describe what happened.
    fn execute(&self, tool: &AgentTool) -> ToolResult;
}

/// The executor a loop holds before a caller wires one: it refuses every call and
/// says so, so a turn reports why nothing ran instead of pretending.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoToolExecutor;

impl ToolExecutor for NoToolExecutor {
    fn execute(&self, tool: &AgentTool) -> ToolResult {
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilesystemToolExecutor {
    working_dir: PathBuf,
}

impl FilesystemToolExecutor {
    /// An executor rooted at `working_dir`.
    ///
    /// Nothing is created or checked here, so construction cannot fail: the
    /// directory is made by the first write and a read or a command in a directory
    /// that does not exist reports an io or spawn failure.
    pub fn new(working_dir: impl Into<PathBuf>) -> Self {
        Self {
            working_dir: working_dir.into(),
        }
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
        let resolved = self.resolve(path)?;
        if let Some(parent) = resolved.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                return Ok(ToolResult::failed(
                    tool,
                    format!("could not create {}: {error}", parent.display()),
                ));
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

    /// Run a program in the working directory and describe the exit.
    fn run_command(&self, command: &str, args: &[String]) -> Result<ToolResult, ToolError> {
        let tool = AgentTool::RunCommand {
            command: command.to_string(),
            args: args.to_vec(),
        };
        if command.trim().is_empty() {
            return Err(ToolError::BlankCommand);
        }
        let output = Command::new(command.trim())
            .args(args)
            .current_dir(&self.working_dir)
            .output();
        let output = match output {
            Ok(output) => output,
            Err(error) => {
                return Err(ToolError::Spawn {
                    command: command.trim().to_string(),
                    error: error.to_string(),
                })
            }
        };

        let mut text = String::new();
        text.push_str(&String::from_utf8_lossy(&output.stdout));
        text.push_str(&String::from_utf8_lossy(&output.stderr));
        if !text.ends_with('\n') && !text.is_empty() {
            text.push('\n');
        }
        let code = output.status.code();
        text.push_str(&match code {
            Some(code) => format!("exit code: {code}"),
            None => "exit code: killed by a signal".to_string(),
        });
        Ok(ToolResult::new(tool, output.status.success(), text))
    }
}

impl ToolExecutor for FilesystemToolExecutor {
    fn execute(&self, tool: &AgentTool) -> ToolResult {
        let outcome = match tool {
            AgentTool::ReadFile { path } => self.read_file(path),
            AgentTool::WriteFile { path, content } => self.write_file(path, content),
            AgentTool::RunCommand { command, args } => self.run_command(command, args),
        };
        match outcome {
            Ok(result) => result,
            Err(error) => ToolResult::failed(tool.clone(), error.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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

    #[test]
    fn a_read_file_tool_returns_the_file_content() {
        let temp = tempdir().expect("a temporary directory");
        std::fs::write(temp.path().join("notes.md"), "first\nsecond\n")
            .expect("the file is written");

        let result = executor(temp.path()).execute(&AgentTool::ReadFile {
            path: "notes.md".to_string(),
        });

        assert!(result.success, "unexpected result: {result:?}");
        assert_eq!(result.output, "first\nsecond\n");
        assert_eq!(result.tool.summary(), "read_file notes.md");
        assert_eq!(result.status(), "ok");
    }

    #[test]
    fn a_write_file_tool_writes_the_content() {
        let temp = tempdir().expect("a temporary directory");

        let result = executor(temp.path()).execute(&AgentTool::WriteFile {
            path: "notes.md".to_string(),
            content: "hello from the agent\n".to_string(),
        });

        assert!(result.success, "unexpected result: {result:?}");
        assert!(result.output.starts_with("wrote 21 bytes to "));
        assert_eq!(
            std::fs::read_to_string(temp.path().join("notes.md")).expect("the file is readable"),
            "hello from the agent\n"
        );
    }

    #[test]
    fn a_write_file_tool_creates_the_parent_directories() {
        let temp = tempdir().expect("a temporary directory");

        let result = executor(temp.path()).execute(&AgentTool::WriteFile {
            path: "factory/runs/turn-1/notes.md".to_string(),
            content: "nested".to_string(),
        });

        assert!(result.success, "unexpected result: {result:?}");
        let written = temp.path().join("factory/runs/turn-1/notes.md");
        assert!(written.is_file(), "{} was not created", written.display());
        assert_eq!(
            std::fs::read_to_string(&written).expect("the file is readable"),
            "nested"
        );
    }

    #[test]
    fn a_read_of_a_missing_file_is_a_failed_result() {
        let temp = tempdir().expect("a temporary directory");

        let result = executor(temp.path()).execute(&AgentTool::ReadFile {
            path: "missing.md".to_string(),
        });

        assert!(!result.success);
        assert_eq!(result.status(), "failed");
        assert!(
            result.output.starts_with("could not read "),
            "unexpected output: {}",
            result.output
        );
        assert!(result.output.contains("missing.md"));
    }

    #[test]
    fn a_run_command_tool_runs_the_command_in_the_working_directory() {
        let temp = tempdir().expect("a temporary directory");
        let (command, args) = printing_command();

        let result = executor(temp.path()).execute(&AgentTool::RunCommand { command, args });

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

    #[test]
    fn a_run_command_tool_reports_a_non_zero_exit_as_a_failed_result() {
        let temp = tempdir().expect("a temporary directory");
        let (command, args) = failing_command();

        let result = executor(temp.path()).execute(&AgentTool::RunCommand { command, args });

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

    #[test]
    fn a_missing_program_is_a_refusal() {
        let temp = tempdir().expect("a temporary directory");

        let result = executor(temp.path()).execute(&AgentTool::RunCommand {
            command: "warsha-no-such-program".to_string(),
            args: Vec::new(),
        });

        assert!(!result.success);
        assert!(
            result
                .output
                .starts_with("could not start warsha-no-such-program"),
            "unexpected output: {}",
            result.output
        );
    }

    #[test]
    fn a_path_outside_the_working_directory_is_refused() {
        let temp = tempdir().expect("a temporary directory");
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

        let result = executor.execute(&AgentTool::WriteFile {
            path: "../escape.md".to_string(),
            content: "no".to_string(),
        });
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

    #[test]
    fn a_blank_path_and_a_blank_command_are_refused() {
        let temp = tempdir().expect("a temporary directory");
        let executor = executor(temp.path());

        assert_eq!(executor.resolve("   "), Err(ToolError::BlankPath));
        let read = executor.execute(&AgentTool::ReadFile {
            path: " ".to_string(),
        });
        assert!(!read.success);
        assert_eq!(read.output, "the path is blank");

        let run = executor.execute(&AgentTool::RunCommand {
            command: "  ".to_string(),
            args: Vec::new(),
        });
        assert!(!run.success);
        assert_eq!(run.output, "the command is blank");
    }

    #[test]
    fn a_dotted_path_resolves_inside_the_working_directory() {
        let temp = tempdir().expect("a temporary directory");
        let executor = executor(temp.path());

        let resolved = executor
            .resolve("./notes.md")
            .expect("a dotted relative path is allowed");
        assert!(resolved.starts_with(temp.path()));
        assert_eq!(executor.working_dir(), temp.path());
    }

    #[test]
    fn the_no_tool_executor_refuses_every_tool() {
        let tool = AgentTool::WriteFile {
            path: "notes.md".to_string(),
            content: "no".to_string(),
        };

        let result = NoToolExecutor.execute(&tool);

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
}
