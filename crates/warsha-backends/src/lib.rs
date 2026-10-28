//! Warsha Backends — Coding backends: builtin agent, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI

use async_trait::async_trait;
use std::path::PathBuf;
use thiserror::Error;
use warsha_core::*;
use warsha_pipeline::PipelineEngine;
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

        // Build command with task prompt
        let mut cmd = tokio::process::Command::new(&self.command);
        cmd.args(&self.args);
        cmd.current_dir(&sandbox.work_dir);

        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }
        for (k, v) in &sandbox.env {
            cmd.env(k, v);
        }

        // In real implementation, we'd pass the task as a prompt
        // For now, just run a dummy command
        let output = cmd
            .arg("--version")
            .output()
            .await
            .map_err(|e| BackendError::ExecutionFailed(e.to_string()))?;

        let duration = start.elapsed().as_millis() as u64;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(BackendError::ExecutionFailed(stderr.to_string()));
        }

        Ok(CodingResult {
            task_id: task.id,
            success: true,
            diff: None,
            files_changed: vec![],
            usage: None,
            error: None,
            duration_ms: duration,
        })
    }
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

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
}
