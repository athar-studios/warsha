//! Warsha Backends — Coding backends: builtin agent, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI

pub mod stream;
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use stream::*;
use tokio::io::AsyncBufReadExt;
use warsha_core::{EventKind, Role, Stage};
pub use warsha_pipeline::coding_backend::{
    BackendError, CodingBackend, CodingResult, CodingTask, FileAction, Result, Sandbox, TaskFile,
};

#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct CliOutput {
    #[allow(dead_code)]
    pub result: String,
    pub usage: Option<CliUsage>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct CliUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[allow(dead_code)]
    pub cache_read_tokens: Option<u64>,
    #[allow(dead_code)]
    pub cache_write_tokens: Option<u64>,
    #[allow(dead_code)]
    pub cost_cents: Option<u64>,
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

    async fn execute(&self, task: CodingTask, sandbox: &Sandbox) -> Result<CodingResult> {
        let session_id = sandbox.session_id.unwrap_or_default();
        if let Some(sender) = &sandbox.event_sender {
            let start_event = warsha_core::Event {
                id: ulid::Ulid::new(),
                run_id: task.run_id,
                stage: Stage::Code,
                role: Some(Role::Coder),
                kind: EventKind::SessionStarted,
                payload: serde_json::json!({
                    "session_id": session_id.to_string(),
                    "backend": "builtin",
                    "note": "no live telemetry for this backend",
                }),
                cost_cents: None,
                tokens: None,
                created_at: Utc::now(),
                device_id: None,
            };
            let _ = sender.send(start_event);

            let end_event = warsha_core::Event {
                id: ulid::Ulid::new(),
                run_id: task.run_id,
                stage: Stage::Code,
                role: Some(Role::Coder),
                kind: EventKind::SessionEnded,
                payload: serde_json::json!({
                    "session_id": session_id.to_string(),
                    "status": "done",
                    "note": "no live telemetry for this backend",
                }),
                cost_cents: None,
                tokens: None,
                created_at: Utc::now(),
                device_id: None,
            };
            let _ = sender.send(end_event);
        }

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
pub const DEFAULT_CODING_CLI_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

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

        let session_id = sandbox.session_id.unwrap_or_default();
        let live_sessions = sandbox.live_sessions.clone();

        let start = std::time::Instant::now();
        let prompt = Self::task_prompt(&task);

        let mut cmd = tokio::process::Command::new(&self.command);
        let is_streaming = matches!(self.name.as_str(), "claude-code" | "codex-cli");

        // Add streaming flags if missing
        let mut args = self.args.clone();
        if is_streaming {
            if self.name == "claude-code" {
                if !args.contains(&"--output-format=stream-json".to_string()) {
                    args.extend([
                        "--output-format=stream-json".to_string(),
                        "--verbose".to_string(),
                    ]);
                }
            } else if self.name == "codex-cli" && !args.contains(&"--json".to_string()) {
                args.push("--json".to_string());
            }
        }

        cmd.args(&args)
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

        #[cfg(unix)]
        {
            cmd.process_group(0);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| BackendError::ExecutionFailed(e.to_string()))?;
        let pid = child.id();

        let mut stop_rx = if let Some(mgr) = &live_sessions {
            if let Some(pid) = pid {
                mgr.update_pid(session_id, pid).await;
            }
            mgr.register(session_id, task.run_id, pid).await
        } else {
            let (_, rx) = tokio::sync::watch::channel(false);
            rx
        };

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| BackendError::Sandbox("stdout not piped".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| BackendError::Sandbox("stderr not piped".to_string()))?;

        let mut stdout_reader = tokio::io::BufReader::new(stdout).lines();
        let mut stderr_reader = tokio::io::BufReader::new(stderr).lines();

        let send_event = |kind: EventKind, payload: serde_json::Value| {
            if let Some(sender) = &sandbox.event_sender {
                let event = warsha_core::Event {
                    id: ulid::Ulid::new(),
                    run_id: task.run_id,
                    stage: Stage::Code,
                    role: Some(Role::Coder),
                    kind,
                    payload,
                    cost_cents: None,
                    tokens: None,
                    created_at: Utc::now(),
                    device_id: None,
                };
                let _ = sender.send(event);
            }
        };

        // Emit session started event
        if is_streaming {
            send_event(
                EventKind::SessionStarted,
                serde_json::json!({
                    "session_id": session_id.to_string(),
                    "backend": self.name,
                }),
            );
        } else {
            send_event(
                EventKind::SessionStarted,
                serde_json::json!({
                    "session_id": session_id.to_string(),
                    "backend": self.name,
                    "note": "no live telemetry for this backend",
                }),
            );
        }

        let mut stdout_done = false;
        let mut stderr_done = false;
        let mut usage: Option<warsha_core::TokenUsage> = None;
        let mut session_ended_emitted = false;
        let mut captured_stdout = Vec::new();
        let mut captured_stderr = Vec::new();
        let exit_status;

        let cli_timeout = task
            .context
            .get("coding_cli_timeout_seconds")
            .and_then(|s| s.parse().ok())
            .map(std::time::Duration::from_secs)
            .unwrap_or(DEFAULT_CODING_CLI_TIMEOUT);
        let timeout = tokio::time::sleep(cli_timeout);
        tokio::pin!(timeout);

        let process_line =
            |l: &str, usage: &mut Option<warsha_core::TokenUsage>, ended: &mut bool| {
                let parsed = if self.name == "claude-code" {
                    parse_claude_stream_line(l)
                } else {
                    parse_codex_stream_line(l)
                };
                for ev in parsed {
                    match ev {
                        StreamEvent::SessionStarted {
                            cli_session_id,
                            model,
                        } => {
                            let mut p = serde_json::json!({
                                "session_id": session_id.to_string(),
                                "status": "starting",
                            });
                            if let Some(cid) = cli_session_id {
                                p["cli_session_id"] = serde_json::Value::String(cid);
                            }
                            if let Some(m) = model {
                                p["model"] = serde_json::Value::String(m);
                            }
                            send_event(EventKind::SessionStatusChanged, p);
                        }
                        StreamEvent::StatusChanged { status } => {
                            send_event(
                                EventKind::SessionStatusChanged,
                                serde_json::json!({
                                    "session_id": session_id.to_string(),
                                    "status": status,
                                }),
                            );
                        }
                        StreamEvent::ToolStarted { tool, target } => {
                            send_event(
                                EventKind::ToolStarted,
                                serde_json::json!({
                                    "session_id": session_id.to_string(),
                                    "tool": tool,
                                    "target": target,
                                }),
                            );
                        }
                        StreamEvent::ToolFinished {
                            tool,
                            target,
                            duration_ms,
                            status,
                        } => {
                            let mut p = serde_json::json!({
                                "session_id": session_id.to_string(),
                                "tool": tool,
                                "target": target,
                                "status": status,
                            });
                            if let Some(d) = duration_ms {
                                p["duration_ms"] = serde_json::Value::from(d);
                            }
                            send_event(EventKind::ToolFinished, p);
                        }
                        StreamEvent::FileTouched { path, action } => {
                            send_event(
                                EventKind::FileTouched,
                                serde_json::json!({
                                    "session_id": session_id.to_string(),
                                    "path": path,
                                    "action": action,
                                }),
                            );
                        }
                        StreamEvent::SessionEnded {
                            status,
                            duration_ms,
                            usage: stream_usage,
                        } => {
                            if let Some(u) = stream_usage {
                                *usage = Some(u);
                            }
                            *ended = true;
                            let mut p = serde_json::json!({
                                "session_id": session_id.to_string(),
                                "status": status,
                            });
                            if let Some(d) = duration_ms {
                                p["duration_ms"] = serde_json::Value::from(d);
                            }
                            send_event(EventKind::SessionEnded, p);
                        }
                    }
                }
            };

        loop {
            tokio::select! {
                line = stdout_reader.next_line(), if !stdout_done => {
                    match line {
                        Ok(Some(l)) => {
                            if let Some(mgr) = &live_sessions {
                                mgr.push_tail_line(session_id, &l).await;
                            }
                            if is_streaming {
                                process_line(&l, &mut usage, &mut session_ended_emitted);
                            }
                            captured_stdout.push(l);
                        }
                        Ok(None) | Err(_) => {
                            stdout_done = true;
                        }
                    }
                }
                line = stderr_reader.next_line(), if !stderr_done => {
                    match line {
                        Ok(Some(l)) => {
                            if let Some(mgr) = &live_sessions {
                                mgr.push_tail_line(session_id, &l).await;
                            }
                            captured_stderr.push(l);
                        }
                        Ok(None) | Err(_) => {
                            stderr_done = true;
                        }
                    }
                }
                _ = stop_rx.changed() => {
                    if *stop_rx.borrow() {
                        if let Some(mgr) = &live_sessions {
                            mgr.unregister(session_id).await;
                        }
                        return Err(BackendError::ExecutionFailed("Stopped by owner".to_string()));
                    }
                }
                _ = &mut timeout => {
                    if let Some(mgr) = &live_sessions {
                        mgr.unregister(session_id).await;
                    }
                    send_event(
                        EventKind::SessionEnded,
                        serde_json::json!({
                            "session_id": session_id.to_string(),
                            "status": "failed",
                            "reason": "timeout",
                        }),
                    );
                    return Err(BackendError::Timeout(format!("{} timed out", self.name)));
                }
                res = child.wait() => {
                    match res {
                        Ok(st) => {
                            exit_status = st;
                            break;
                        }
                        Err(e) => {
                            if let Some(mgr) = &live_sessions {
                                mgr.unregister(session_id).await;
                            }
                            return Err(BackendError::ExecutionFailed(e.to_string()));
                        }
                    }
                }
            }
        }

        // Drain remaining lines
        while let Ok(Some(l)) = stdout_reader.next_line().await {
            if let Some(mgr) = &live_sessions {
                mgr.push_tail_line(session_id, &l).await;
            }
            if is_streaming {
                process_line(&l, &mut usage, &mut session_ended_emitted);
            }
            captured_stdout.push(l);
        }
        while let Ok(Some(l)) = stderr_reader.next_line().await {
            if let Some(mgr) = &live_sessions {
                mgr.push_tail_line(session_id, &l).await;
            }
            captured_stderr.push(l);
        }

        if let Some(mgr) = &live_sessions {
            mgr.unregister(session_id).await;
        }

        let st = exit_status;

        if !is_streaming {
            send_event(
                EventKind::SessionEnded,
                serde_json::json!({
                    "session_id": session_id.to_string(),
                    "status": if st.success() { "done" } else { "failed" },
                    "note": "no live telemetry for this backend",
                }),
            );
        } else if !session_ended_emitted {
            send_event(
                EventKind::SessionEnded,
                serde_json::json!({
                    "session_id": session_id.to_string(),
                    "status": if st.success() { "done" } else { "failed" },
                }),
            );
        }

        if usage.is_none() {
            let full_stdout = captured_stdout.join("\n");
            if let Ok(cli_out) = serde_json::from_str::<CliOutput>(&full_stdout) {
                usage = Some(warsha_core::TokenUsage {
                    input: cli_out.usage.as_ref().map(|u| u.input_tokens).unwrap_or(0),
                    output: cli_out.usage.as_ref().map(|u| u.output_tokens).unwrap_or(0),
                    total: cli_out
                        .usage
                        .as_ref()
                        .map(|u| u.input_tokens + u.output_tokens)
                        .unwrap_or(0),
                    cost_cents: cli_out.usage.as_ref().and_then(|u| u.cost_cents),
                });
            } else if self.name == "codex-cli" {
                let mut total_input = 0;
                let mut total_output = 0;
                for line in captured_stdout.iter() {
                    if let Ok(line_out) = serde_json::from_str::<serde_json::Value>(line) {
                        if let Some(u) = line_out.get("usage") {
                            total_input +=
                                u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            total_output +=
                                u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        }
                    }
                }
                if total_input > 0 || total_output > 0 {
                    usage = Some(warsha_core::TokenUsage {
                        input: total_input,
                        output: total_output,
                        total: total_input + total_output,
                        cost_cents: None,
                    });
                }
            }
        }

        if !st.success() {
            if *stop_rx.borrow() {
                return Err(BackendError::ExecutionFailed(
                    "Stopped by owner".to_string(),
                ));
            }
            let stderr_str = captured_stderr.join("\n").trim().to_string();
            let stdout_str = captured_stdout.join("\n").trim().to_string();
            let detail = if stderr_str.is_empty() {
                stdout_str
            } else {
                stderr_str
            };
            return Err(BackendError::ExecutionFailed(if detail.is_empty() {
                format!("{} exited with {:?}", self.name, st.code())
            } else {
                detail
            }));
        }

        let duration = start.elapsed().as_millis() as u64;
        let (diff, files_changed) = capture_changes(&sandbox.work_dir).await;

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
    mod cli_parsing;
    mod streaming_acceptance;
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
            worktree_path: None,
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
                worktree_path: None,
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
            // The CLI stage requires an assigned run worktree (N3): point the
            // run at the project checkout itself, the way the daemon's
            // worktree creation would.
            run.worktree_path = project.repo_path.clone();
            run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
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

        /// N0: a CLI-reported cost is real spend for the budget. A fake CLI emits
        /// Claude-style JSON with `cost_cents`; the Code stage must add it to
        /// `run.spent_cents`, and a budget the spend crosses must pause the run
        /// and record `BudgetExceeded` — the CLI's own subscription spend is not
        /// invisible to the owner's ceiling.
        #[cfg(unix)]
        #[tokio::test]
        async fn a_cli_reported_cost_counts_toward_the_run_budget() {
            let _env_guard = ENV_GUARD.lock().await;
            let _env = EnvRestore::remove();

            let temp = tempfile::tempdir().expect("a temp dir");
            let repo = temp.path().join("repo");
            std::fs::create_dir(&repo).expect("the repository directory");
            std::fs::write(repo.join("base.txt"), "base").expect("a base file");
            // 500 input + 250 output tokens and a reported cost of 7 cents.
            let cli = fake_cli(
                &repo,
                "printf '%s' \"$*\" > prompt.txt\nprintf 'changed' > base.txt\ncat <<'JSON'\n{\"result\":\"done\",\"usage\":{\"input_tokens\":500,\"output_tokens\":250,\"cost_cents\":7}}\nJSON",
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
            engine
                .set_run_budget(run.id, 5)
                .await
                .expect("the budget is set");

            let run = engine
                .advance_stage(run.id)
                .await
                .expect("the Code stage runs through the selected CLI");

            assert_eq!(
                run.spent_cents, 7,
                "the CLI-reported cost did not reach the run's spend"
            );
            assert_eq!(
                run.status,
                RunStatus::Paused,
                "crossing the budget must pause the run"
            );

            let events = store.get_events(run.id).await.expect("events are readable");
            let step = events
                .iter()
                .find(|event| event.kind == EventKind::AgentStep && event.stage == Stage::Code)
                .expect("the Code step is on the record");
            assert_eq!(
                step.cost_cents,
                Some(7),
                "the Code step must record the CLI-reported cost"
            );
            assert_eq!(step.payload["backend"], "fake");
            assert_eq!(step.payload["cost_source"], "cli_reported");
            assert_eq!(step.payload["cost_known"], true);
            let exceeded = events
                .iter()
                .find(|event| event.kind == EventKind::BudgetExceeded)
                .expect("crossing the budget must record BudgetExceeded");
            assert_eq!(exceeded.payload["budget_cents"], 5);
            assert_eq!(exceeded.payload["spent_cents"], 7);
        }
    }
}
