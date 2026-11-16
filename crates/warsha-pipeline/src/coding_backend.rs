use crate::live_session::LiveSessionManager;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use ulid::Ulid;
use warsha_core::*;

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

pub type EventSender = tokio::sync::mpsc::UnboundedSender<Event>;

/// Sandbox for code execution
pub struct Sandbox {
    pub work_dir: PathBuf,
    pub allow_network: bool,
    pub env: HashMap<String, String>,
    pub event_sender: Option<EventSender>,
    pub session_id: Option<SessionId>,
    pub live_sessions: Option<Arc<LiveSessionManager>>,
}

impl Sandbox {
    pub fn new(work_dir: PathBuf) -> Self {
        Self {
            work_dir,
            allow_network: true,
            env: HashMap::new(),
            event_sender: None,
            session_id: None,
            live_sessions: None,
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

    pub fn with_session(mut self, session_id: SessionId) -> Self {
        self.session_id = Some(session_id);
        self
    }

    pub fn with_live_sessions(mut self, live_sessions: Arc<LiveSessionManager>) -> Self {
        self.live_sessions = Some(live_sessions);
        self
    }
}
