//! Command execution policy for the agent's `RunCommand` tool (KEEL K4).
//!
//! Defines the pipeline-side seam that screens every command before it spawns:
//!
//! - Extracts and judges the FIRST token from [`split_command`] against a
//!   configured allow-list (defaulting to [`DEFAULT_ALLOWED_COMMANDS`], mirroring
//!   the daemon's process policy without creating a `warsha-pipeline -> warshad`
//!   dependency forbidden by architecture rule R2).
//! - Explicitly refuses shells (`sh`, `bash`, `cmd`, `powershell`, `pwsh`) unless
//!   the owner's configured allow-list explicitly admits them.
//! - Rejects shell metacharacters and `..` path traversal in the program token.
//! - Executes via `tokio::process::Command` with `kill_on_drop(true)`,
//!   `env_clear()` plus a minimal fixed environment (never inheriting daemon or
//!   provider secrets), a 120-second default timeout, and a 1 MiB output cap.
//! - On timeout, sends a kill signal and waits for the child so no orphaned or
//!   zombie process remains.

use std::path::{Component, Path};
use std::process::Stdio;
use std::time::Duration;

use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::process_spawn::{split_command, ProcessError};

/// The default programs the agent may run: the toolchains a generated project
/// builds and tests with, and no shells or arbitrary command-line interpreters.
pub const DEFAULT_ALLOWED_COMMANDS: &[&str] = &[
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "bun",
    "node",
    "deno",
    "cargo",
    "rustc",
    "git",
    "make",
    "cmake",
    "go",
    "dotnet",
    "java",
    "javac",
    "mvn",
    "gradle",
    "php",
    "composer",
    "bundle",
    "rails",
    "vite",
    "next",
    "tsc",
    "eslint",
    "prettier",
    "sqlite3",
    "pocketbase",
    "task",
    "just",
];

/// Shell binaries refused by default unless explicitly present in the configured allow-list.
pub const SHELL_COMMANDS: &[&str] = &["sh", "bash", "cmd", "powershell", "pwsh"];

/// Shell metacharacters forbidden inside a program token.
const COMMAND_METACHARACTERS: &[char] = &[';', '|', '&', '`', '$', '\n', '\r', '>', '<'];

/// Default command execution timeout (120 seconds).
pub const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

/// Default captured output limit per command invocation (1 MiB).
pub const DEFAULT_OUTPUT_CAP_BYTES: usize = 1024 * 1024;

/// Fixed, minimal child environment set after `env_clear()`.
///
/// Nothing is copied from the daemon's own environment, so provider keys,
/// bearer tokens, user profile paths, and daemon configuration never reach a
/// spawned tool process.
#[cfg(windows)]
pub const MINIMAL_CHILD_ENV: &[(&str, &str)] = &[
    ("PATH", r"C:\Windows\System32;C:\Windows"),
    ("SYSTEMROOT", r"C:\Windows"),
    ("TERM", "dumb"),
    ("NO_COLOR", "1"),
];

/// Fixed, minimal child environment set after `env_clear()` (Unix).
#[cfg(not(windows))]
pub const MINIMAL_CHILD_ENV: &[(&str, &str)] = &[
    ("PATH", "/usr/local/bin:/usr/bin:/bin"),
    ("LANG", "C.UTF-8"),
    ("LC_ALL", "C.UTF-8"),
    ("TERM", "dumb"),
    ("NO_COLOR", "1"),
];

/// Errors produced when validating or executing an agent command.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CommandPolicyError {
    /// The command string was empty or whitespace-only.
    #[error("the command is blank")]
    BlankCommand,
    /// The command string failed tokenization (e.g. an unclosed quote).
    #[error("invalid command `{command}`: {reason}")]
    InvalidCommand {
        /// The raw command input.
        command: String,
        /// Why tokenization failed.
        reason: String,
    },
    /// The program token contains shell metacharacters.
    #[error("`{command}` names shell syntax rather than a program; only a program and its arguments may run")]
    ShellSyntax {
        /// The offending program token.
        command: String,
    },
    /// The program token contains a parent directory traversal (`..`).
    #[error("`{command}` climbs with `..`; a program path may not contain parent traversal")]
    ParentTraversal {
        /// The offending program token.
        command: String,
    },
    /// A shell (`sh`, `bash`, `cmd`, `powershell`, `pwsh`) was requested without being allow-listed.
    #[error("shell `{command}` is refused unless explicitly allow-listed")]
    ShellRefused {
        /// The normalized shell name.
        command: String,
    },
    /// The program is not present in the policy's allow-list.
    #[error("`{command}` is not in the allowed commands list")]
    NotAllowed {
        /// The normalized program name.
        command: String,
    },
    /// Spawning the process failed.
    #[error("could not start {command}: {error}")]
    Spawn {
        /// The program that was named.
        command: String,
        /// The rendered I/O error.
        error: String,
    },
    /// Waiting on the process failed.
    #[error("command `{command}` wait failed: {error}")]
    Wait {
        /// The program that was running.
        command: String,
        /// The rendered I/O error.
        error: String,
    },
    /// The child exceeded the configured timeout and was killed.
    #[error("command `{command}` timed out after {timeout:?} and was killed")]
    TimedOut {
        /// The program that was running.
        command: String,
        /// The timeout duration that elapsed.
        timeout: Duration,
    },
}

/// Output captured from a completed command execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutput {
    /// Whether the process exited with status code 0.
    pub success: bool,
    /// Process exit code, or `None` if terminated by a signal.
    pub exit_code: Option<i32>,
    /// Captured stdout bytes (capped).
    pub stdout: Vec<u8>,
    /// Captured stderr bytes (capped).
    pub stderr: Vec<u8>,
    /// Whether combined output exceeded [`CommandPolicy::output_cap_bytes`] and was truncated.
    pub truncated: bool,
}

impl CommandOutput {
    /// Format stdout, stderr, truncation notice, and exit status into the agent-facing string.
    pub fn format_text(&self) -> String {
        let mut text = String::new();
        text.push_str(&String::from_utf8_lossy(&self.stdout));
        text.push_str(&String::from_utf8_lossy(&self.stderr));
        if self.truncated {
            if !text.ends_with('\n') && !text.is_empty() {
                text.push('\n');
            }
            text.push_str("[output truncated at 1 MiB cap]");
        }
        if !text.ends_with('\n') && !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&match self.exit_code {
            Some(code) => format!("exit code: {code}"),
            None => "exit code: killed by a signal".to_string(),
        });
        text
    }
}

/// Pipeline-side allow-list and execution policy for `RunCommand`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandPolicy {
    allowed: Vec<String>,
    timeout: Duration,
    output_cap_bytes: usize,
}

impl Default for CommandPolicy {
    fn default() -> Self {
        Self::from_config(&[])
    }
}

impl CommandPolicy {
    /// Construct a policy from configured allow-list entries.
    ///
    /// An empty slice installs [`DEFAULT_ALLOWED_COMMANDS`], matching the daemon's
    /// configuration rule that unset means the default safe set rather than
    /// unrestricted execution.
    pub fn from_config(allowed: &[String]) -> Self {
        let allowed = if allowed.is_empty() {
            DEFAULT_ALLOWED_COMMANDS
                .iter()
                .map(|name| (*name).to_string())
                .collect()
        } else {
            allowed
                .iter()
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .collect()
        };
        Self {
            allowed,
            timeout: DEFAULT_COMMAND_TIMEOUT,
            output_cap_bytes: DEFAULT_OUTPUT_CAP_BYTES,
        }
    }

    /// Construct a policy with an empty allow-list that refuses every command.
    pub fn deny_all() -> Self {
        Self {
            allowed: Vec::new(),
            timeout: DEFAULT_COMMAND_TIMEOUT,
            output_cap_bytes: DEFAULT_OUTPUT_CAP_BYTES,
        }
    }

    /// Override the execution timeout.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Override the output capture cap in bytes.
    pub fn with_output_cap(mut self, output_cap_bytes: usize) -> Self {
        self.output_cap_bytes = output_cap_bytes;
        self
    }

    /// The configured allow-list entries.
    pub fn allowed(&self) -> &[String] {
        &self.allowed
    }

    /// The configured execution timeout.
    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    /// The configured output capture cap in bytes.
    pub fn output_cap_bytes(&self) -> usize {
        self.output_cap_bytes
    }

    /// Judge the FIRST `split_command` token of `command_line` against this policy.
    ///
    /// Returns the extracted first token when allowed.
    pub fn check_command(&self, command_line: &str) -> Result<String, CommandPolicyError> {
        let (first, _) = parse_command_line(command_line)?;
        self.check_program(&first)?;
        Ok(first)
    }

    /// Judge a single program token against this policy.
    pub fn check_program(&self, program_token: &str) -> Result<(), CommandPolicyError> {
        let trimmed = program_token.trim();
        if trimmed.is_empty() {
            return Err(CommandPolicyError::BlankCommand);
        }
        if trimmed
            .chars()
            .any(|ch| COMMAND_METACHARACTERS.contains(&ch))
        {
            return Err(CommandPolicyError::ShellSyntax {
                command: trimmed.to_string(),
            });
        }
        if Path::new(trimmed)
            .components()
            .any(|component| component == Component::ParentDir)
        {
            return Err(CommandPolicyError::ParentTraversal {
                command: trimmed.to_string(),
            });
        }

        let program = program_name(trimmed);
        if program.is_empty() {
            return Err(CommandPolicyError::BlankCommand);
        }

        let allowed = self
            .allowed
            .iter()
            .any(|entry| entry == trimmed || program_name(entry) == program);
        if allowed {
            return Ok(());
        }

        if SHELL_COMMANDS.contains(&program.as_str()) {
            return Err(CommandPolicyError::ShellRefused { command: program });
        }

        Err(CommandPolicyError::NotAllowed { command: program })
    }

    /// Validate and execute a command in `working_dir` under this policy.
    pub async fn execute(
        &self,
        command: &str,
        args: &[String],
        working_dir: &Path,
    ) -> Result<CommandOutput, CommandPolicyError> {
        let (_pid, result) = self.execute_with_pid(command, args, working_dir).await;
        result
    }

    /// Validate and execute a command, also returning the spawned OS PID when started.
    async fn execute_with_pid(
        &self,
        command: &str,
        args: &[String],
        working_dir: &Path,
    ) -> (Option<u32>, Result<CommandOutput, CommandPolicyError>) {
        let (program, effective_args) = match resolve_program_and_args(command, args) {
            Ok(resolved) => resolved,
            Err(err) => return (None, Err(err)),
        };

        if let Err(err) = self.check_program(&program) {
            return (None, Err(err));
        }

        let mut cmd = Command::new(&program);
        cmd.args(&effective_args);
        cmd.current_dir(working_dir);
        cmd.kill_on_drop(true);
        cmd.env_clear();
        for (key, value) in MINIMAL_CHILD_ENV {
            cmd.env(key, value);
        }
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(error) => {
                return (
                    None,
                    Err(CommandPolicyError::Spawn {
                        command: program,
                        error: error.to_string(),
                    }),
                )
            }
        };

        let pid = child.id();
        let cap = self.output_cap_bytes;
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        let mut stdout_task = tokio::spawn(read_stream_capped(stdout_pipe, cap));
        let mut stderr_task = tokio::spawn(read_stream_capped(stderr_pipe, cap));

        let wait_fut = async {
            let status = child.wait().await;
            let out = (&mut stdout_task).await;
            let err = (&mut stderr_task).await;
            (status, out, err)
        };

        match tokio::time::timeout(self.timeout, wait_fut).await {
            Ok((status_res, out_res, err_res)) => match status_res {
                Ok(status) => {
                    let (stdout, out_trunc) = out_res.unwrap_or_default();
                    let (stderr, err_trunc) = err_res.unwrap_or_default();
                    let (stdout, stderr, combined_trunc) = cap_combined(stdout, stderr, cap);
                    (
                        pid,
                        Ok(CommandOutput {
                            success: status.success(),
                            exit_code: status.code(),
                            stdout,
                            stderr,
                            truncated: out_trunc || err_trunc || combined_trunc,
                        }),
                    )
                }
                Err(error) => (
                    pid,
                    Err(CommandPolicyError::Wait {
                        command: program,
                        error: error.to_string(),
                    }),
                ),
            },
            Err(_) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                stdout_task.abort();
                stderr_task.abort();
                (
                    pid,
                    Err(CommandPolicyError::TimedOut {
                        command: program,
                        timeout: self.timeout,
                    }),
                )
            }
        }
    }
}

/// Split a command string with [`split_command`], mapping errors into [`CommandPolicyError`].
fn parse_command_line(command_line: &str) -> Result<(String, Vec<String>), CommandPolicyError> {
    match split_command(command_line) {
        Ok(parsed) => Ok(parsed),
        Err(ProcessError::EmptyCommand) => Err(CommandPolicyError::BlankCommand),
        Err(ProcessError::UnterminatedQuote { quote }) => Err(CommandPolicyError::InvalidCommand {
            command: command_line.trim().to_string(),
            reason: format!("unterminated {quote} quote"),
        }),
        Err(other) => Err(CommandPolicyError::InvalidCommand {
            command: command_line.trim().to_string(),
            reason: other.to_string(),
        }),
    }
}

/// Resolve the program token and effective argument list.
///
/// When `args` is empty, `command` is parsed via [`split_command`] so a single
/// command line such as `"sh -c id"` or `"cargo --version"` yields its first
/// token for policy inspection. When `args` is non-empty, `command` is still
/// parsed for its first token unless it directly names an existing file path on
/// disk (for example an unquoted Windows path containing spaces).
fn resolve_program_and_args(
    command: &str,
    args: &[String],
) -> Result<(String, Vec<String>), CommandPolicyError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(CommandPolicyError::BlankCommand);
    }
    if args.is_empty() {
        return parse_command_line(trimmed);
    }
    let (first, extra) = parse_command_line(trimmed)?;
    if extra.is_empty() {
        return Ok((first, args.to_vec()));
    }
    if Path::new(trimmed).is_file() {
        return Ok((trimmed.to_string(), args.to_vec()));
    }
    let combined = extra.into_iter().chain(args.iter().cloned()).collect();
    Ok((first, combined))
}

/// Normalize a program token to its lowercase base binary name without Windows
/// executable suffixes (`.exe`, `.cmd`, `.bat`), matching `warshad::auth`.
pub(crate) fn program_name(command: &str) -> String {
    let trimmed = command.trim().trim_matches('"').trim_matches('\'');
    let name = trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    name.strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".cmd"))
        .or_else(|| name.strip_suffix(".bat"))
        .unwrap_or(&name)
        .to_string()
}

/// Read up to `cap` bytes from a child stream; if any additional byte arrives,
/// record `truncated = true` and close the stream.
async fn read_stream_capped<R: tokio::io::AsyncRead + Unpin>(
    pipe: Option<R>,
    cap: usize,
) -> (Vec<u8>, bool) {
    let Some(mut reader) = pipe else {
        return (Vec::new(), false);
    };
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        if buf.len() >= cap {
            let mut probe = [0u8; 1];
            let extra = matches!(reader.read(&mut probe).await, Ok(n) if n > 0);
            return (buf, extra);
        }
        let max_read = (cap - buf.len()).min(chunk.len());
        match reader.read(&mut chunk[..max_read]).await {
            Ok(0) | Err(_) => return (buf, false),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
}

/// Enforce the combined `cap` across stdout and stderr.
fn cap_combined(mut stdout: Vec<u8>, mut stderr: Vec<u8>, cap: usize) -> (Vec<u8>, Vec<u8>, bool) {
    let total = stdout.len().saturating_add(stderr.len());
    if total <= cap {
        return (stdout, stderr, false);
    }
    if stdout.len() >= cap {
        stdout.truncate(cap);
        return (stdout, Vec::new(), true);
    }
    let remaining = cap - stdout.len();
    stderr.truncate(remaining);
    (stdout, stderr, true)
}

#[cfg(test)]
static ENV_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
struct EnvVarGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
}

#[cfg(test)]
impl EnvVarGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

#[cfg(test)]
impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(prev) => std::env::set_var(self.key, prev),
            None => std::env::remove_var(self.key),
        }
    }
}

#[cfg(test)]
#[cfg(windows)]
async fn pid_is_alive(pid: u32) -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
        .await
        .expect("tasklist should run on Windows");
    String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\""))
}

#[cfg(test)]
#[cfg(not(windows))]
async fn pid_is_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(test)]
#[test]
fn refused_command_not_in_allowlist_is_refused() {
    let policy = CommandPolicy::default();
    for bad in ["rm", "curl", "wget", "python", "/usr/bin/cat", "nc.exe"] {
        let err = policy
            .check_command(&format!("{bad} --help"))
            .expect_err("unlisted command must be refused");
        assert!(
            matches!(err, CommandPolicyError::NotAllowed { .. }),
            "expected NotAllowed for `{bad}`, got {err:?}"
        );
    }

    let narrow = CommandPolicy::from_config(&["cargo".to_string()]);
    assert!(matches!(
        narrow.check_command("npm test"),
        Err(CommandPolicyError::NotAllowed { .. })
    ));
    assert!(narrow.check_command("cargo test").is_ok());
}

#[cfg(test)]
#[test]
fn allowed_commands_and_paths_pass_policy_check() {
    let policy = CommandPolicy::default();
    assert_eq!(
        policy.check_command("cargo test --all").ok(),
        Some("cargo".to_string())
    );
    assert_eq!(
        policy.check_command("NPM.CMD run build").ok(),
        Some("NPM.CMD".to_string())
    );
    assert_eq!(
        policy
            .check_command("\"/usr/local/bin/node\" index.js")
            .ok(),
        Some("/usr/local/bin/node".to_string())
    );
    assert_eq!(
        policy.check_command("./git status").ok(),
        Some("./git".to_string())
    );
}

#[cfg(test)]
#[test]
fn shells_are_refused_unless_explicitly_allowlisted() {
    let policy = CommandPolicy::default();
    for shell in [
        "sh",
        "sh -c 'echo pwn'",
        "/bin/sh",
        "bash",
        "/usr/bin/bash -lc id",
        "cmd",
        "cmd.exe /C whoami",
        r"C:\Windows\System32\cmd.exe /C dir",
        "powershell",
        "powershell.exe -Command Get-Process",
        "pwsh",
        "/usr/local/bin/pwsh -c ls",
    ] {
        let err = policy
            .check_command(shell)
            .expect_err("shell must be refused by default");
        assert!(
            matches!(err, CommandPolicyError::ShellRefused { .. }),
            "expected ShellRefused for `{shell}`, got {err:?}"
        );
    }

    let allowing_sh = CommandPolicy::from_config(&["sh".to_string(), "cmd".to_string()]);
    assert!(allowing_sh.check_command("sh -c echo").is_ok());
    assert!(allowing_sh.check_command("cmd.exe /C echo").is_ok());
    assert!(matches!(
        allowing_sh.check_command("bash -c echo"),
        Err(CommandPolicyError::ShellRefused { .. })
    ));
}

#[cfg(test)]
#[test]
fn shell_metacharacters_and_parent_traversal_are_refused() {
    let policy = CommandPolicy::from_config(&["cargo".to_string(), "sh".to_string()]);
    for bad in [
        "cargo;rm",
        "cargo|cat",
        "cargo&id",
        "`cargo`",
        "$(cargo)",
        "cargo>out",
    ] {
        let err = policy
            .check_command(bad)
            .expect_err("metacharacters in program token must be refused");
        assert!(
            matches!(err, CommandPolicyError::ShellSyntax { .. }),
            "expected ShellSyntax for `{bad}`, got {err:?}"
        );
    }

    for traversal in [
        "../cargo",
        "/usr/bin/../bin/cargo",
        r"..\..\Windows\System32\cmd.exe",
    ] {
        let err = policy
            .check_command(traversal)
            .expect_err("parent traversal must be refused");
        assert!(
            matches!(err, CommandPolicyError::ParentTraversal { .. }),
            "expected ParentTraversal for `{traversal}`, got {err:?}"
        );
    }
}

#[cfg(test)]
#[tokio::test]
async fn a_child_that_prints_its_environment_sees_none_of_the_daemons_variables() {
    let _lock = ENV_TEST_LOCK.lock().await;
    let _g1 = EnvVarGuard::set("WARSHA_LLM_API_KEY", "sk-secret-llm-key-value");
    let _g2 = EnvVarGuard::set("WARSHA_AUTH_TOKEN", "daemon-secret-auth-token");
    let _g3 = EnvVarGuard::set("OPENAI_API_KEY", "sk-openai-daemon-secret");
    let _g4 = EnvVarGuard::set("ANTHROPIC_API_KEY", "sk-anthropic-daemon-secret");
    let _g5 = EnvVarGuard::set("WARSHA_DAEMON_SECRET_CANARY", "canary-secret-12345");

    let temp = crate::test_util::fresh_tempdir();

    #[cfg(windows)]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["cmd".to_string()]),
        "cmd",
        vec!["/C".to_string(), "set".to_string()],
    );
    #[cfg(not(windows))]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["env".to_string()]),
        "env",
        Vec::new(),
    );

    let output = policy
        .execute(cmd, &args, temp.path())
        .await
        .expect("allow-listed env printer should execute");
    assert!(output.success, "env printer failed: {:?}", output);
    let stdout = String::from_utf8_lossy(&output.stdout);

    for secret in [
        "WARSHA_LLM_API_KEY",
        "sk-secret-llm-key-value",
        "WARSHA_AUTH_TOKEN",
        "daemon-secret-auth-token",
        "OPENAI_API_KEY",
        "sk-openai-daemon-secret",
        "ANTHROPIC_API_KEY",
        "sk-anthropic-daemon-secret",
        "WARSHA_DAEMON_SECRET_CANARY",
        "canary-secret-12345",
        "CARGO_PKG_NAME",
        "CARGO_MANIFEST_DIR",
        "USERPROFILE",
        "APPDATA",
        "HOME=",
    ] {
        assert!(
            !stdout.contains(secret),
            "daemon variable `{secret}` leaked into child environment:\n{stdout}"
        );
    }

    assert!(
        stdout.contains("TERM=dumb"),
        "expected fixed minimal env in child output:\n{stdout}"
    );
    assert!(
        stdout.contains("NO_COLOR=1"),
        "expected fixed minimal env in child output:\n{stdout}"
    );
}

#[cfg(test)]
#[tokio::test]
async fn a_sleeping_child_is_killed_at_the_timeout_and_no_process_remains() {
    let temp = crate::test_util::fresh_tempdir();

    #[cfg(windows)]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["ping".to_string()]).with_timeout(Duration::from_millis(200)),
        "ping",
        vec!["-n".to_string(), "30".to_string(), "127.0.0.1".to_string()],
    );
    #[cfg(not(windows))]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["sleep".to_string()]).with_timeout(Duration::from_millis(200)),
        "sleep",
        vec!["30".to_string()],
    );

    let started = std::time::Instant::now();
    let (pid, result) = policy.execute_with_pid(cmd, &args, temp.path()).await;
    let elapsed = started.elapsed();

    assert!(
        elapsed < Duration::from_secs(5),
        "timeout did not interrupt sleeping child in time: {elapsed:?}"
    );
    let err = result.expect_err("sleeping child should time out");
    assert!(
        matches!(err, CommandPolicyError::TimedOut { .. }),
        "expected TimedOut error, got {err:?}"
    );

    let pid = pid.expect("spawned child should have an OS pid");
    assert!(
        !pid_is_alive(pid).await,
        "killed child process {pid} still exists in OS process table"
    );
}

#[cfg(test)]
#[tokio::test]
async fn defaults_and_output_cap_are_enforced() {
    let default_policy = CommandPolicy::default();
    assert_eq!(default_policy.timeout(), Duration::from_secs(120));
    assert_eq!(default_policy.output_cap_bytes(), 1024 * 1024);

    let temp = crate::test_util::fresh_tempdir();
    let payload = "A".repeat(4096);

    #[cfg(windows)]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["cmd".to_string()]).with_output_cap(256),
        "cmd",
        vec!["/C".to_string(), format!("echo {payload}")],
    );
    #[cfg(not(windows))]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["printf".to_string()]).with_output_cap(256),
        "printf",
        vec!["%s".to_string(), payload],
    );

    let output = policy
        .execute(cmd, &args, temp.path())
        .await
        .expect("allow-listed command should run");
    assert!(
        output.truncated,
        "output exceeding cap should be marked truncated"
    );
    assert!(output.stdout.len() + output.stderr.len() <= 256);
    assert!(output
        .format_text()
        .contains("[output truncated at 1 MiB cap]"));
}
