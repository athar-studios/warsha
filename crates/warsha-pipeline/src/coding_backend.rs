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
    pub worktree_path: Option<PathBuf>,
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
    /// Whether this backend has an explicit permission-mapping table entry
    /// (such as read-only launch arguments). Backends without a mapping are
    /// refused under read-only confinement unless the tree-hash backstop is active.
    fn has_permission_mapping(&self) -> bool {
        false
    }
    async fn execute(&self, task: CodingTask, sandbox: &Sandbox) -> Result<CodingResult>;
}

/// Registry and per-project / per-role selection table for coding backends (R-NEXT N2).
#[derive(Default)]
pub struct CodingBackendRegistry {
    backends: std::sync::RwLock<HashMap<String, Arc<dyn CodingBackend>>>,
    default_backend: std::sync::RwLock<Option<String>>,
    project_backends: std::sync::RwLock<HashMap<ProjectId, String>>,
    role_backends: std::sync::RwLock<HashMap<Role, String>>,
    project_role_backends: std::sync::RwLock<HashMap<(ProjectId, Role), String>>,
}

impl CodingBackendRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, backend: Arc<dyn CodingBackend>) {
        let mut map = self.backends.write().unwrap_or_else(|e| e.into_inner());
        map.insert(backend.name().to_string(), backend);
    }

    pub fn unregister(&self, name: &str) {
        let mut map = self.backends.write().unwrap_or_else(|e| e.into_inner());
        map.remove(name);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn CodingBackend>> {
        let map = self.backends.read().unwrap_or_else(|e| e.into_inner());
        map.get(name).cloned()
    }

    pub fn contains(&self, name: &str) -> bool {
        let map = self.backends.read().unwrap_or_else(|e| e.into_inner());
        map.contains_key(name)
    }

    pub fn registered_names(&self) -> Vec<String> {
        let map = self.backends.read().unwrap_or_else(|e| e.into_inner());
        let mut names: Vec<_> = map.keys().cloned().collect();
        names.sort();
        names
    }

    pub fn set_default_backend(&self, name: Option<String>) {
        let mut def = self
            .default_backend
            .write()
            .unwrap_or_else(|e| e.into_inner());
        *def = name.filter(|s| !s.trim().is_empty());
    }

    pub fn default_backend(&self) -> Option<String> {
        self.default_backend
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn set_project_backend(&self, project_id: ProjectId, backend: impl Into<String>) {
        self.project_backends
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(project_id, backend.into());
    }

    pub fn set_role_backend(&self, role: Role, backend: impl Into<String>) {
        self.role_backends
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(role, backend.into());
    }

    pub fn set_project_role_backend(
        &self,
        project_id: ProjectId,
        role: Role,
        backend: impl Into<String>,
    ) {
        self.project_role_backends
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert((project_id, role), backend.into());
    }

    pub fn clear_project_backend(&self, project_id: &ProjectId) {
        self.project_backends
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(project_id);
    }

    pub fn clear_role_backend(&self, role: &Role) {
        self.role_backends
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(role);
    }

    /// Resolve the backend configured for `(project_id, role)`.
    ///
    /// Precedence:
    /// 1. `(project_id, role)`
    /// 2. `project_id`
    /// 3. `role`
    /// 4. `default_backend`
    ///
    /// Returns:
    /// - `Ok(Some(backend))` when a configured backend is registered.
    /// - `Ok(None)` when no backend is configured (caller may use provider routing).
    /// - `Err(unknown_name)` when a backend name IS configured but not registered
    ///   (A16.11: must fail by name, never silently fall back to provider routing).
    pub fn resolve(
        &self,
        project_id: Option<ProjectId>,
        role: Role,
    ) -> std::result::Result<Option<Arc<dyn CodingBackend>>, String> {
        let configured_name = {
            let pr_map = self
                .project_role_backends
                .read()
                .unwrap_or_else(|e| e.into_inner());
            let p_map = self
                .project_backends
                .read()
                .unwrap_or_else(|e| e.into_inner());
            let r_map = self.role_backends.read().unwrap_or_else(|e| e.into_inner());
            let def = self
                .default_backend
                .read()
                .unwrap_or_else(|e| e.into_inner());

            if let Some(pid) = project_id {
                pr_map
                    .get(&(pid, role))
                    .or_else(|| p_map.get(&pid))
                    .or_else(|| r_map.get(&role))
                    .or(def.as_ref())
                    .cloned()
            } else {
                r_map.get(&role).or(def.as_ref()).cloned()
            }
        };

        match configured_name {
            Some(name) => {
                let map = self.backends.read().unwrap_or_else(|e| e.into_inner());
                match map.get(&name) {
                    Some(backend) => Ok(Some(backend.clone())),
                    None => Err(name),
                }
            }
            None => Ok(None),
        }
    }
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

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;

    struct DummyBackend {
        name: String,
    }

    #[async_trait]
    impl CodingBackend for DummyBackend {
        fn name(&self) -> &str {
            &self.name
        }

        fn is_available(&self) -> bool {
            true
        }

        async fn execute(&self, task: CodingTask, _sandbox: &Sandbox) -> Result<CodingResult> {
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

    #[test]
    fn registry_precedence_and_unknown_error() {
        let reg = CodingBackendRegistry::new();
        let p1 = ProjectId::new();
        let p2 = ProjectId::new();

        // Nothing configured -> Ok(None)
        assert!(reg.resolve(Some(p1), Role::Coder).unwrap().is_none());

        reg.register(Arc::new(DummyBackend {
            name: "default-eng".to_string(),
        }));
        reg.register(Arc::new(DummyBackend {
            name: "role-eng".to_string(),
        }));
        reg.register(Arc::new(DummyBackend {
            name: "proj-eng".to_string(),
        }));
        reg.register(Arc::new(DummyBackend {
            name: "proj-role-eng".to_string(),
        }));

        reg.set_default_backend(Some("default-eng".to_string()));
        assert_eq!(
            reg.resolve(Some(p1), Role::Coder).unwrap().unwrap().name(),
            "default-eng"
        );

        reg.set_role_backend(Role::Coder, "role-eng");
        assert_eq!(
            reg.resolve(Some(p1), Role::Coder).unwrap().unwrap().name(),
            "role-eng"
        );
        // Other role falls back to default
        assert_eq!(
            reg.resolve(Some(p1), Role::Architect)
                .unwrap()
                .unwrap()
                .name(),
            "default-eng"
        );

        reg.set_project_backend(p1, "proj-eng");
        assert_eq!(
            reg.resolve(Some(p1), Role::Coder).unwrap().unwrap().name(),
            "proj-eng"
        );
        // Other project still gets role backend
        assert_eq!(
            reg.resolve(Some(p2), Role::Coder).unwrap().unwrap().name(),
            "role-eng"
        );

        reg.set_project_role_backend(p1, Role::Coder, "proj-role-eng");
        assert_eq!(
            reg.resolve(Some(p1), Role::Coder).unwrap().unwrap().name(),
            "proj-role-eng"
        );

        // Unknown configured backend -> Err(unknown_name)
        reg.set_project_backend(p2, "ghost-cli");
        let err = reg
            .resolve(Some(p2), Role::Coder)
            .err()
            .expect("unknown err");
        assert_eq!(err, "ghost-cli");
    }
}
