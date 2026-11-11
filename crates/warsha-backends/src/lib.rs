//! Warsha Backends — Coding backends: builtin agent, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;
use ulid::Ulid;
use warsha_core::*;
use which::which;

#[derive(Error, Debug)]
pub enum BackendError {
    #[error("Backend not found: {0}")]
    NotFound(String),
    #[error("Backend not installed: {0}")]
    NotInstalled(String),
    #[error("Execution failed: {0}")]
    ExecutionFailed(String),
    #[error("Timeout: {0}")]
    Timeout(String),
    #[error("Sandbox error: {0}")]
    Sandbox(String),
    #[error("Other: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, BackendError>;

/// Task for a coding backend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodingTask {
    pub id: Ulid,
    pub run_id: RunId,
    pub title: String,
    pub description: String,
    pub repo_path: PathBuf,
    pub branch_name: String,
    pub base_branch: String,
    pub files: Vec<TaskFile>,
    pub context: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFile {
    pub path: String,
    pub content: String,
    pub action: FileAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileAction {
    Create,
    Modify,
    Delete,
}

/// Result of a coding task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodingResult {
    pub task_id: Ulid,
    pub success: bool,
    pub diff: Option<String>,
    pub files_changed: Vec<String>,
    pub usage: Option<TokenUsage>,
    pub error: Option<String>,
    pub duration_ms: u64,
}

/// Trait for coding backends
#[async_trait]
pub trait CodingBackend: Send + Sync {
    fn name(&self) -> &str;
    fn is_available(&self) -> bool;
    async fn execute(&self, task: CodingTask, sandbox: &Sandbox) -> Result<CodingResult>;
}

/// Sandbox for code execution
pub struct Sandbox {
    pub work_dir: PathBuf,
    pub allow_network: bool,
    pub env: HashMap<String, String>,
}

impl Sandbox {
    pub fn new(work_dir: PathBuf) -> Self {
        Self {
            work_dir,
            allow_network: true,
            env: HashMap::new(),
        }
    }

    pub fn with_network(mut self, allow: bool) -> Self {
        self.allow_network = allow;
        self
    }

    pub fn with_env(mut self, key: String, value: String) -> Self {
        self.env.insert(key, value);
        self
    }
}

/// Built-in test backend (minimal implementation for testing)
pub struct BuiltinBackend;

#[async_trait]
impl CodingBackend for BuiltinBackend {
    fn name(&self) -> &str {
        "builtin"
    }

    fn is_available(&self) -> bool {
        true
    }

    async fn execute(&self, task: CodingTask, _sandbox: &Sandbox) -> Result<CodingResult> {
        // Minimal implementation - just return success with no changes
        Ok(CodingResult {
            task_id: task.id,
            success: true,
            diff: None,
            files_changed: vec![],
            usage: None,
            error: None,
            duration_ms: 0,
        })
    }
}

/// CLI backend base - runs a command
pub struct CliBackend {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env_vars: HashMap<String, String>,
}

/// The wall-clock bound a coding CLI gets before the backend gives up.
pub const CODING_CLI_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

impl CliBackend {
    pub fn new(name: &str, command: &str, args: Vec<String>) -> Self {
        Self {
            name: name.to_string(),
            command: command.to_string(),
            args,
            env_vars: HashMap::new(),
        }
    }

    pub fn check_installed(&self) -> bool {
        which(&self.command).is_ok()
    }

    /// The prompt handed to the coding CLI: the task, its files and its context.
    fn task_prompt(task: &CodingTask) -> String {
        let mut prompt = format!("{}\n\n{}", task.title.trim(), task.description.trim());
        if !task.files.is_empty() {
            prompt.push_str("\n\nFiles:\n");
            for file in &task.files {
                prompt.push_str(&format!("- {} ({:?})\n", file.path, file.action));
            }
        }
        for (key, value) in &task.context {
            prompt.push_str(&format!("- {key}: {value}\n"));
        }
        prompt.trim().to_string()
    }
}

#[async_trait]
impl CodingBackend for CliBackend {
    fn name(&self) -> &str {
        &self.name
    }

    fn is_available(&self) -> bool {
        self.check_installed()
    }

    async fn execute(&self, task: CodingTask, sandbox: &Sandbox) -> Result<CodingResult> {
        if !self.is_available() {
            return Err(BackendError::NotInstalled(format!(
                "{} not found in PATH",
                self.command
            )));
        }

        let start = std::time::Instant::now();
        let prompt = Self::task_prompt(&task);

        // The coding CLI receives the task as its last argument (after the
        // backend-specific flags: `claude -p <prompt>`, `codex exec <prompt>`, …),
        // runs in the sandbox directory, and inherits the caller's environment so
        // its own authentication works. stdin is closed: a CLI waiting for one
        // must fail rather than hang a run.
        let mut cmd = tokio::process::Command::new(&self.command);
        cmd.args(&self.args)
            .arg(&prompt)
            .current_dir(&sandbox.work_dir)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }
        for (k, v) in &sandbox.env {
            cmd.env(k, v);
        }

        let output = tokio::time::timeout(CODING_CLI_TIMEOUT, cmd.output())
            .await
            .map_err(|_| {
                BackendError::Timeout(format!(
                    "{} did not finish within {CODING_CLI_TIMEOUT:?}",
                    self.name
                ))
            })?
            .map_err(|e| BackendError::ExecutionFailed(e.to_string()))?;

        let duration = start.elapsed().as_millis() as u64;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if stderr.is_empty() { stdout } else { stderr };
            return Err(BackendError::ExecutionFailed(if detail.is_empty() {
                format!("{} exited with {:?}", self.name, output.status.code())
            } else {
                detail
            }));
        }

        // The result is the change the CLI actually made, not a claim: the diff
        // and the changed paths come from git in the sandbox. A non-git sandbox
        // reports no diff instead of failing a successful run.
        let (diff, files_changed) = capture_changes(&sandbox.work_dir).await;

        Ok(CodingResult {
            task_id: task.id,
            success: true,
            diff,
            files_changed,
            usage: None,
            error: None,
            duration_ms: duration,
        })
    }
}

/// The diff and changed paths a run left in `work_dir`, or an empty pair when it
/// is not a git repository. Read-only: it never stages, commits or cleans.
async fn capture_changes(work_dir: &std::path::Path) -> (Option<String>, Vec<String>) {
    let status = tokio::process::Command::new("git")
        .arg("-C")
        .arg(work_dir)
        .args(["status", "--porcelain"])
        .output()
        .await;
    let diff = tokio::process::Command::new("git")
        .arg("-C")
        .arg(work_dir)
        .args(["diff", "HEAD"])
        .output()
        .await;

    let mut files = Vec::new();
    if let Ok(output) = status {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Some(path) = line.get(3..) {
                    let path = path.trim();
                    if !path.is_empty() {
                        files.push(path.to_string());
                    }
                }
            }
        }
    }
    let diff = diff
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .filter(|diff| !diff.trim().is_empty());
    (diff, files)
}

/// Factory for creating backends
pub struct BackendFactory;

impl BackendFactory {
    pub fn builtin() -> Box<dyn CodingBackend> {
        Box::new(BuiltinBackend)
    }

    pub fn claude_code() -> Box<dyn CodingBackend> {
        Box::new(CliBackend::new(
            "claude-code",
            "claude",
            vec!["-p".to_string()],
        ))
    }

    pub fn codex_cli() -> Box<dyn CodingBackend> {
        Box::new(CliBackend::new(
            "codex-cli",
            "codex",
            vec!["exec".to_string()],
        ))
    }

    pub fn gemini_cli() -> Box<dyn CodingBackend> {
        Box::new(CliBackend::new("gemini-cli", "gemini", vec![]))
    }

    pub fn cursor_cli() -> Box<dyn CodingBackend> {
        Box::new(CliBackend::new(
            "cursor-cli",
            "cursor",
            vec!["--cli".to_string()],
        ))
    }

    pub fn opencode() -> Box<dyn CodingBackend> {
        Box::new(CliBackend::new(
            "opencode",
            "opencode",
            vec!["run".to_string()],
        ))
    }

    pub fn openhands() -> Box<dyn CodingBackend> {
        Box::new(CliBackend::new("openhands", "openhands", vec![]))
    }

    pub fn all_available() -> Vec<Box<dyn CodingBackend>> {
        vec![
            Self::builtin(),
            Self::claude_code(),
            Self::codex_cli(),
            Self::gemini_cli(),
            Self::cursor_cli(),
            Self::opencode(),
            Self::openhands(),
        ]
        .into_iter()
        .filter(|b| b.is_available())
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_builtin_backend() {
        let backend = BuiltinBackend;
        assert!(backend.is_available());
        assert_eq!(backend.name(), "builtin");

        let task = CodingTask {
            id: Ulid::new(),
            run_id: RunId::new(),
            title: "Test".to_string(),
            description: "Test task".to_string(),
            repo_path: PathBuf::from("/tmp"),
            branch_name: "test".to_string(),
            base_branch: "main".to_string(),
            files: vec![],
            context: HashMap::new(),
        };

        let sandbox = Sandbox::new(PathBuf::from("/tmp"));
        let result = backend.execute(task, &sandbox).await.unwrap();
        assert!(result.success);
    }

    #[test]
    fn test_cli_backend_check() {
        let backend = CliBackend::new("test", "nonexistent-command-xyz", vec![]);
        assert!(!backend.is_available());
    }

    /// ENGINE E4: the coding CLI really receives the task, and the result is the
    /// change it made (git diff/status), not a `--version` dummy.
    mod e4 {
        use super::*;
        use std::process::Command;

        fn task(title: &str, description: &str) -> CodingTask {
            CodingTask {
                id: Ulid::new(),
                run_id: RunId::new(),
                title: title.to_string(),
                description: description.to_string(),
                repo_path: PathBuf::from("."),
                branch_name: "main".to_string(),
                base_branch: "main".to_string(),
                files: vec![TaskFile {
                    path: "src/lib.rs".to_string(),
                    content: String::new(),
                    action: FileAction::Modify,
                }],
                context: HashMap::from([("project".to_string(), "Shop".to_string())]),
            }
        }

        #[test]
        fn the_prompt_names_the_task_files_and_context() {
            let prompt = CliBackend::task_prompt(&task("Add a page", "Make the page render"));
            assert!(prompt.contains("Add a page"));
            assert!(prompt.contains("Make the page render"));
            assert!(prompt.contains("src/lib.rs"));
            assert!(prompt.contains("project: Shop"));
        }

        #[cfg(unix)]
        fn fake_cli(dir: &std::path::Path, body: &str) -> PathBuf {
            use std::os::unix::fs::PermissionsExt;
            let path = dir.join("fake-coding-cli");
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("the fake CLI is written");
            let mut permissions = std::fs::metadata(&path)
                .expect("the script exists")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).expect("the script is executable");
            path
        }

        #[cfg(unix)]
        fn git_repo(dir: &std::path::Path) {
            for args in [
                vec!["init", "-q"],
                vec!["config", "user.email", "test@example.com"],
                vec!["config", "user.name", "Test"],
                vec!["add", "."],
                vec!["commit", "-qm", "base"],
            ] {
                let status = Command::new("git")
                    .current_dir(dir)
                    .args(&args)
                    .status()
                    .expect("git runs");
                assert!(status.success(), "git {args:?} failed");
            }
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn a_fake_cli_receives_the_prompt_and_its_changes_are_reported() {
            let temp = tempfile::tempdir().expect("a temp dir");
            std::fs::write(temp.path().join("base.txt"), "base").expect("a base file");
            git_repo(temp.path());
            let cli = fake_cli(
                temp.path(),
                "printf '%s' \"$*\" > prompt.txt\nprintf 'changed' > base.txt\nprintf 'made' > made.txt",
            );
            let backend = CliBackend::new("fake", cli.to_str().expect("a utf8 path"), vec![]);
            let sandbox = Sandbox::new(temp.path().to_path_buf());

            let result = backend
                .execute(task("Add a page", "Make the page render"), &sandbox)
                .await
                .expect("the fake CLI succeeds");

            assert!(result.success);
            assert!(
                result.files_changed.iter().any(|path| path == "made.txt"),
                "{:?}",
                result.files_changed
            );
            assert!(
                result.files_changed.iter().any(|path| path == "base.txt"),
                "{:?}",
                result.files_changed
            );
            let diff = result.diff.expect("a diff is captured");
            assert!(diff.contains("base.txt"), "{diff}");
            let prompt = std::fs::read_to_string(temp.path().join("prompt.txt"))
                .expect("the prompt is recorded");
            assert!(prompt.contains("Add a page"), "{prompt}");
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn a_failing_cli_is_an_execution_error_with_its_stderr() {
            let temp = tempfile::tempdir().expect("a temp dir");
            let cli = fake_cli(temp.path(), "echo 'boom: cannot proceed' >&2\nexit 3");
            let backend = CliBackend::new("fake", cli.to_str().expect("a utf8 path"), vec![]);
            let sandbox = Sandbox::new(temp.path().to_path_buf());

            let error = backend
                .execute(task("T", "D"), &sandbox)
                .await
                .expect_err("the CLI failed");

            assert!(
                matches!(error, BackendError::ExecutionFailed(_)),
                "{error:?}"
            );
            assert!(error.to_string().contains("boom"), "{error}");
        }

        #[tokio::test]
        async fn a_missing_command_is_not_installed() {
            let backend = CliBackend::new("missing", "warsha-no-such-cli-xyz", vec![]);
            let sandbox = Sandbox::new(PathBuf::from("."));

            let error = backend
                .execute(task("T", "D"), &sandbox)
                .await
                .expect_err("the CLI is missing");

            assert!(matches!(error, BackendError::NotInstalled(_)), "{error:?}");
        }
    }
}
