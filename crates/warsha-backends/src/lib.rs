//! Warsha Backends — Coding backends: builtin agent, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI

use async_trait::async_trait;
use std::collections::HashMap;
pub use warsha_pipeline::coding_backend::{
    BackendError, CodingBackend, CodingResult, CodingTask, FileAction, Result, Sandbox, TaskFile,
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
struct CliOutput {
    #[allow(dead_code)]
    result: String,
    usage: Option<CliUsage>,
}

#[derive(Debug, Clone, Deserialize)]
struct CliUsage {
    input_tokens: u64,
    output_tokens: u64,
    #[allow(dead_code)]
    cache_read_tokens: Option<u64>,
    #[allow(dead_code)]
    cache_write_tokens: Option<u64>,
    #[allow(dead_code)]
    cost_cents: Option<u64>,
}
use which::which;

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

        let mut usage = None;
        let stdout = String::from_utf8_lossy(&output.stdout);
        
        // Try parsing as JSON (Claude Code style)
        if let Ok(cli_out) = serde_json::from_str::<CliOutput>(&stdout) {
            usage = Some(warsha_core::TokenUsage {
                input: cli_out.usage.as_ref().map(|u| u.input_tokens).unwrap_or(0),
                output: cli_out.usage.as_ref().map(|u| u.output_tokens).unwrap_or(0),
                total: cli_out
                    .usage
                    .as_ref()
                    .map(|u| u.input_tokens + u.output_tokens)
                    .unwrap_or(0),
            });
        } else if self.name == "codex-cli" {
            // Try parsing as JSONL (Codex CLI style)
            let mut total_input = 0;
            let mut total_output = 0;
            for line in stdout.lines() {
                if let Ok(line_out) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(u) = line_out.get("usage") {
                        total_input += u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        total_output += u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    }
                }
            }
            if total_input > 0 || total_output > 0 {
                usage = Some(warsha_core::TokenUsage {
                    input: total_input,
                    output: total_output,
                    total: total_input + total_output,
                });
            }
        }

        Ok(CodingResult {
            task_id: task.id,
            success: true,
            diff,
            files_changed,
            usage,
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
            vec!["exec".to_string(), "--json".to_string()],
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

    /// Every backend the factory can build, in inventory order.
    pub fn all() -> Vec<Box<dyn CodingBackend>> {
        vec![
            Self::builtin(),
            Self::claude_code(),
            Self::codex_cli(),
            Self::gemini_cli(),
            Self::cursor_cli(),
            Self::opencode(),
            Self::openhands(),
        ]
    }

    /// The backend a selection names, or `None` when no backend carries that name.
    ///
    /// The backend is returned even when it is not installed: the caller that
    /// selected it has to report an absent CLI instead of silently falling back to
    /// another way of running the stage.
    pub fn named(name: &str) -> Option<Box<dyn CodingBackend>> {
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        Self::all()
            .into_iter()
            .find(|backend| backend.name() == name)
    }

    /// The backend [`CODING_BACKEND_ENV`] names, when the variable is set.
    ///
    /// Unset — the default — leaves the Code stage on the routed provider. The
    /// selection is a wiring-side concern: the pipeline receives the resolved
    /// backend through its constructor and never reads the environment itself.
    pub fn from_env() -> Option<Box<dyn CodingBackend>> {
        let name = std::env::var(CODING_BACKEND_ENV).ok()?;
        Self::named(&name)
    }

    pub fn all_available() -> Vec<Box<dyn CodingBackend>> {
        Self::all()
            .into_iter()
            .filter(|b| b.is_available())
            .collect()
    }
}

/// The environment variable that names the coding CLI the Code stage runs through.
///
/// Unset — the default — leaves the Code stage on the routed provider. A name is
/// one [`BackendFactory`] knows, e.g. `claude-code` or `codex-cli`.
pub const CODING_BACKEND_ENV: &str = "WARSHA_CODING_BACKEND";

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use ulid::Ulid;
    use warsha_core::RunId;

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

    #[test]
    fn the_inventory_names_every_backend_and_availability_filters_it() {
        let names: Vec<String> = BackendFactory::all()
            .iter()
            .map(|backend| backend.name().to_string())
            .collect();
        assert_eq!(
            names,
            [
                "builtin",
                "claude-code",
                "codex-cli",
                "gemini-cli",
                "cursor-cli",
                "opencode",
                "openhands",
            ]
        );
        assert!(
            BackendFactory::all_available()
                .iter()
                .any(|backend| backend.name() == "builtin"),
            "the always-available builtin backend is not in the available inventory"
        );
    }

    #[test]
    fn a_named_backend_is_returned_even_when_its_cli_is_absent() {
        let backend = BackendFactory::named("claude-code").expect("the inventory names it");
        assert_eq!(backend.name(), "claude-code");
        assert!(BackendFactory::named("no-such-backend").is_none());
        assert!(BackendFactory::named("  ").is_none());
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

    /// ENGINE E4: the Code stage executes through a selected coding CLI, and the
    /// artifact it records is the change the CLI actually made.
    mod e4_coding_cli {
        use super::*;
        use chrono::Utc;
        use std::sync::Arc;
        use tokio::sync::RwLock;
        use warsha_core::{EventKind, Project, ProjectId, Role, Run, RunStatus, Stage};
        use warsha_pipeline::settings::{SettingsProvider, SettingsStore};
        use warsha_pipeline::{PipelineEngine, PipelineError};
        use warsha_providers::{MockProvider, ProviderRouter};
        use warsha_store::Store;

        /// Serialises the tests that read or write [`crate::CODING_BACKEND_ENV`].
        static ENV_GUARD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

        /// Puts the coding-backend variable back the way the test found it.
        struct EnvRestore {
            previous: Option<String>,
        }

        impl EnvRestore {
            fn set(value: &str) -> Self {
                let previous = std::env::var(crate::CODING_BACKEND_ENV).ok();
                std::env::set_var(crate::CODING_BACKEND_ENV, value);
                Self { previous }
            }

            fn remove() -> Self {
                let previous = std::env::var(crate::CODING_BACKEND_ENV).ok();
                std::env::remove_var(crate::CODING_BACKEND_ENV);
                Self { previous }
            }
        }

        impl Drop for EnvRestore {
            fn drop(&mut self) {
                match &self.previous {
                    Some(value) => std::env::set_var(crate::CODING_BACKEND_ENV, value),
                    None => std::env::remove_var(crate::CODING_BACKEND_ENV),
                }
            }
        }

        async fn temp_store() -> Arc<Store> {
            let dir = tempfile::tempdir().expect("a temp dir");
            let path = dir.path().join("test.db");
            let store = Store::open_at(path).await.expect("the store opens");
            std::mem::forget(dir);
            Arc::new(store)
        }

        fn setup_providers_with_mock() -> Arc<RwLock<ProviderRouter>> {
            let mut router = ProviderRouter::new();
            let mock = MockProvider::new("test");
            router.register_provider(Box::new(mock));
            Arc::new(RwLock::new(router))
        }

        fn setup_settings() -> Arc<SettingsStore> {
            Arc::new(SettingsStore::new())
        }

        fn coding_project(repo_path: Option<&std::path::Path>) -> Project {
            Project {
                id: ProjectId::new(),
                name: "Coding Project".to_string(),
                description: "A project with code to write".to_string(),
                language: "en".to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                repo_path: repo_path.map(|path| path.to_string_lossy().into_owned()),
                repo_url: None,
            }
        }

        /// A run sitting at [`Stage::PlanTasks`], so the next advance executes Code.
        async fn run_before_code<S: SettingsProvider>(
            store: &Arc<Store>,
            engine: &PipelineEngine<S>,
            project: &Project,
        ) -> Run {
            store.create_project(project).await.expect("a project");
            let run = engine
                .start_run(project.id, "Build a todo app")
                .await
                .expect("a run starts");
            let mut run = store.get_run(run.id).await.expect("the run is readable");
            run.current_stage = Stage::PlanTasks;
            store
                .update_run(&run)
                .await
                .expect("the run is at planning");
            run
        }

        #[cfg(unix)]
        fn fake_cli(dir: &std::path::Path, body: &str) -> std::path::PathBuf {
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
                let status = std::process::Command::new("git")
                    .current_dir(dir)
                    .args(&args)
                    .status()
                    .expect("git runs");
                assert!(status.success(), "git {args:?} failed");
            }
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn the_code_stage_runs_the_selected_cli_and_reports_its_changes() {
            let _env_guard = ENV_GUARD.lock().await;
            let _env = EnvRestore::remove();

            let temp = tempfile::tempdir().expect("a temp dir");
            let repo = temp.path().join("repo");
            std::fs::create_dir(&repo).expect("the repository directory");
            std::fs::write(repo.join("base.txt"), "base").expect("a base file");
            let cli = fake_cli(
                &repo,
                "printf '%s' \"$*\" > prompt.txt\nprintf 'changed' > base.txt\nprintf 'made' > made.txt",
            );
            git_repo(&repo);

            let store = temp_store().await;
            let project = coding_project(Some(&repo));
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings())
                    .with_coding_backend(Arc::new(CliBackend::new(
                        "fake",
                        cli.to_str().expect("a utf8 path"),
                        vec![],
                    )));
            let run = run_before_code(&store, &engine, &project).await;

            let run = engine
                .advance_stage(run.id)
                .await
                .expect("the Code stage runs through the selected CLI");

            assert_eq!(run.current_stage, Stage::Code);
            let code = run.artifacts.get("code").expect("the Code artifact");
            assert!(
                code.content.contains("made.txt"),
                "the artifact does not name a file the CLI made: {}",
                code.content
            );
            assert!(
                code.content.contains("base.txt"),
                "the artifact does not name a file the CLI changed: {}",
                code.content
            );
            assert!(
                code.content.contains("```diff"),
                "the artifact carries no diff: {}",
                code.content
            );
            assert_eq!(
                run.spent_cents, 0,
                "a coding CLI run was charged as a provider call"
            );

            let prompt = std::fs::read_to_string(repo.join("prompt.txt"))
                .expect("the CLI recorded its prompt");
            assert!(
                prompt.contains("Coding Project") && prompt.contains("role: coder"),
                "the CLI did not receive the Code-stage prompt: {prompt}"
            );

            let events = store.get_events(run.id).await.expect("events are readable");
            let step = events
                .iter()
                .find(|event| event.kind == EventKind::AgentStep && event.stage == Stage::Code)
                .expect("the Code step is on the record");
            assert_eq!(step.payload["backend"], "fake");
        }

        #[tokio::test]
        async fn an_unavailable_coding_backend_fails_the_stage_cleanly() {
            let _env_guard = ENV_GUARD.lock().await;
            let _env = EnvRestore::remove();

            let store = temp_store().await;
            let project = coding_project(Some(std::path::Path::new("/nonexistent-repo")));
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings())
                    .with_coding_backend(Arc::new(CliBackend::new(
                        "missing",
                        "warsha-no-such-coding-cli-xyz",
                        vec![],
                    )));
            let run = run_before_code(&store, &engine, &project).await;

            let error = engine
                .advance_stage(run.id)
                .await
                .expect_err("a backend whose CLI is absent must fail, not run");

            assert!(
                error.to_string().contains("not installed"),
                "the failure does not name the absent CLI: {error}"
            );
            let stored = store.get_run(run.id).await.expect("the run is readable");
            assert_eq!(
                stored.status,
                RunStatus::Failed,
                "the run was left running after the backend could not start"
            );
            let events = store.get_events(run.id).await.expect("events are readable");
            assert!(
                events.iter().any(|event| event.kind == EventKind::Error
                    && event.payload["action"] == "stage_failed"),
                "no error event explains the failed Code stage"
            );
        }

        #[tokio::test]
        async fn no_selection_leaves_the_code_stage_on_the_provider() {
            let _env_guard = ENV_GUARD.lock().await;
            let _env = EnvRestore::remove();

            let store = temp_store().await;
            let project = coding_project(None);
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings());
            let run = run_before_code(&store, &engine, &project).await;

            let error = engine
                .advance_stage(run.id)
                .await
                .expect_err("an unrouted Coder has no provider");

            assert!(
                matches!(error, PipelineError::NoProviderRouted(Role::Coder)),
                "{error:?}"
            );
            let stored = store.get_run(run.id).await.expect("the run is readable");
            assert_eq!(stored.status, RunStatus::Paused);
        }

        #[tokio::test]
        async fn the_environment_names_the_code_stage_backend() {
            let _env_guard = ENV_GUARD.lock().await;
            let _env = EnvRestore::set("claude-code");

            // The wiring side (warshad) resolves the environment name and injects
            // the backend; the pipeline itself never reads the variable.
            let selected = BackendFactory::from_env().expect("the named backend resolves");
            assert_eq!(selected.name(), "claude-code");
        }
    }
}
