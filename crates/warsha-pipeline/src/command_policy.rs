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
//!   Traversal is judged by splitting the token on **both** `/` and `\`, so the
//!   same command line is classified the same way on Windows and Unix instead of
//!   depending on the host's [`std::path`] separator rules.
//! - Executes via `tokio::process::Command` with `kill_on_drop(true)`,
//!   `env_clear()` plus a minimal fixed environment (never inheriting daemon or
//!   provider secrets), a 120-second default timeout, and a 1 MiB output cap. The
//!   child `PATH` is the daemon's own `PATH` — a `PATH` is not a secret, and the
//!   allow-listed toolchains (`cargo`, `node`, …) only resolve through it — while
//!   every other variable stays cleared.
//! - On timeout, the direct child is signalled, killed and reaped. On Unix the
//!   child is spawned in its own process group and the group is killed too, so an
//!   allow-listed toolchain's forked descendants do not survive; on Windows only
//!   the direct child is covered (a Job Object is K8's follow-up).

use std::path::Path;
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
/// spawned tool process. The `PATH` entry here is the **fallback** used only when
/// the daemon itself has no non-empty `PATH`; otherwise the child receives the
/// daemon's own `PATH` through [`child_path`], because the allow-listed
/// toolchains live in the owner's `PATH` (`~/.cargo/bin`, nvm, volta) and a
/// `PATH` carries no secret.
#[cfg(windows)]
pub const MINIMAL_CHILD_ENV: &[(&str, &str)] = &[
    ("PATH", r"C:\Windows\System32;C:\Windows"),
    ("SYSTEMROOT", r"C:\Windows"),
    ("TERM", "dumb"),
    ("NO_COLOR", "1"),
];

/// Fixed, minimal child environment set after `env_clear()` (Unix).
///
/// See the Windows variant: `PATH` is a fallback, replaced by the daemon's own
/// `PATH` whenever that is present.
#[cfg(not(windows))]
pub const MINIMAL_CHILD_ENV: &[(&str, &str)] = &[
    ("PATH", "/usr/local/bin:/usr/bin:/bin"),
    ("LANG", "C.UTF-8"),
    ("LC_ALL", "C.UTF-8"),
    ("TERM", "dumb"),
    ("NO_COLOR", "1"),
];

/// The `PATH` a child receives: the daemon's own, or the fixed fallback.
///
/// A `PATH` is not a secret — it is the owner's trust domain, and the
/// allow-listed programs (`cargo` under `~/.cargo/bin`, `node` under nvm/volta)
/// are only reachable through it. Everything else in the environment is still
/// cleared. An absent or whitespace-only variable falls back to the fixed list
/// in [`MINIMAL_CHILD_ENV`].
pub(crate) fn child_path() -> String {
    std::env::var("PATH")
        .ok()
        .filter(|path| !path.trim().is_empty())
        .unwrap_or_else(|| {
            MINIMAL_CHILD_ENV
                .iter()
                .find(|(key, _)| *key == "PATH")
                .map(|(_, value)| (*value).to_string())
                .unwrap_or_default()
        })
}

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
        if has_parent_traversal(trimmed) {
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
        // The fixed set above is the fallback; the real PATH is the daemon's own.
        cmd.env("PATH", child_path());
        // A group of its own, so a timeout can signal the toolchain's descendants
        // as well as the direct child (see the timeout branch below).
        #[cfg(unix)]
        cmd.process_group(0);
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
                // On Unix the child leads its own process group
                // (`process_group(0)` at spawn), so signalling `-pid` reaches the
                // toolchain's descendants too — a dev server's workers, a test
                // runner's forked children. `kill(1)` is POSIX and needs no crate;
                // if it is missing the group signal fails and the direct child is
                // still killed and reaped below.
                #[cfg(unix)]
                if let Some(pid) = pid {
                    kill_process_group(pid);
                }
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

/// Whether the program token climbs with `..` under either separator convention.
///
/// [`Path::components`](std::path::Path::components) is host-dependent: on Unix a
/// backslash is an ordinary character, so `..\..\Windows\System32\cmd.exe` is one
/// literal file name there and would not be seen as a parent directory. The same
/// command line must be refused on every host, so the token is split on **both**
/// `/` and `\` and any segment that is exactly `..` is a traversal — which also
/// covers a bare `..` and a leading `..\`. Surrounding quotes are stripped first
/// because [`split_command`] keeps them on the first token.
fn has_parent_traversal(program_token: &str) -> bool {
    let unquoted = program_token.trim().trim_matches('"').trim_matches('\'');
    unquoted.split(['/', '\\']).any(|segment| segment == "..")
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

/// Read up to `cap` bytes from a child stream, then drain the rest.
///
/// Reaching the cap does not close the pipe: the remaining bytes are read and
/// discarded until EOF, so `truncated = true` reports the cut without killing
/// the producer (`SIGPIPE` would make a passing command look failed). Draining
/// only reads, so the wait is still bounded by the child's own exit or the
/// caller's timeout.
async fn read_stream_capped<R: tokio::io::AsyncRead + Unpin>(
    pipe: Option<R>,
    cap: usize,
) -> (Vec<u8>, bool) {
    let Some(mut reader) = pipe else {
        return (Vec::new(), false);
    };
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        let max_read = if buf.len() >= cap {
            chunk.len()
        } else {
            (cap - buf.len()).min(chunk.len())
        };
        match reader.read(&mut chunk[..max_read]).await {
            Ok(0) | Err(_) => return (buf, truncated),
            Ok(n) => {
                if buf.len() >= cap {
                    truncated = true;
                } else {
                    let keep = (cap - buf.len()).min(n);
                    buf.extend_from_slice(&chunk[..keep]);
                    truncated |= keep < n;
                }
            }
        }
    }
}

/// Send `SIGKILL` to the process group led by `pid` (Unix).
///
/// The child spawned by [`CommandPolicy::execute_with_pid`] called
/// `process_group(0)`, so its process group id equals its own pid and
/// `kill -KILL -- -<pid>` targets exactly that group. `kill(1)` is a POSIX
/// utility, so no crate is added; a missing utility makes the call a no-op and
/// leaves the direct child's `start_kill` as the only signal (the descendant gap
/// is recorded in the K4 repair report for K8's trust-boundaries text).
#[cfg(unix)]
fn kill_process_group(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-KILL", "--", &format!("-{pid}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
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
        // Host-independent: a backslash is a separator on Windows and a literal
        // character on Unix, and both must be refused on both.
        r"..\..\bin\sh",
        r"..\cargo",
        "..",
        "\"..\"",
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
#[cfg(windows)]
fn is_path_line(line: &str) -> bool {
    line.to_ascii_lowercase().starts_with("path=")
}

#[cfg(test)]
#[cfg(not(windows))]
fn is_path_line(line: &str) -> bool {
    line.starts_with("PATH=")
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

/// K4.4's regression guard: the daemon's own `PATH` reaches the child (so
/// `cargo` under `~/.cargo/bin` resolves), while a planted secret still does not.
#[cfg(test)]
#[tokio::test]
async fn the_child_inherits_the_daemons_path_but_no_secret() {
    let _lock = ENV_TEST_LOCK.lock().await;
    let _canary = EnvVarGuard::set("WARSHA_DAEMON_SECRET_CANARY", "canary-secret-12345");
    let parent_path = std::env::var("PATH").expect("the test process has a PATH");

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

    let line = stdout
        .lines()
        .find(|line| is_path_line(line))
        .unwrap_or_else(|| panic!("child printed no PATH:\n{stdout}"));
    let child_path = line
        .split_once('=')
        .map(|(_, value)| value)
        .unwrap_or_default();
    assert_eq!(
        child_path, parent_path,
        "the child must see the daemon's PATH so allow-listed toolchains resolve"
    );

    assert!(
        !stdout.contains("WARSHA_DAEMON_SECRET_CANARY") && !stdout.contains("canary-secret-12345"),
        "a planted secret leaked into the child environment:\n{stdout}"
    );
}

#[cfg(test)]
#[cfg(not(windows))]
async fn pid_is_gone_within(pid: u32, within: Duration) -> bool {
    let deadline = std::time::Instant::now() + within;
    loop {
        if !pid_is_alive(pid).await {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
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
        "killed direct child process {pid} still exists in OS process table"
    );
}

/// The claim the timeout makes about descendants: on Unix the child leads its
/// own process group, so the timeout's group signal takes a forked grandchild
/// with it. K4.3 (the frozen row) asserts the direct child only; this test is
/// what makes "no process remains" true for the descendants a dev server or a
/// test runner spawns.
#[cfg(test)]
#[cfg(not(windows))]
#[tokio::test]
async fn a_timed_out_command_takes_its_descendants_with_it() {
    let temp = crate::test_util::fresh_tempdir();
    let pid_file = temp.path().join("grandchild.pid");
    let script = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());

    let policy =
        CommandPolicy::from_config(&["sh".to_string()]).with_timeout(Duration::from_secs(2));
    let (_pid, result) = policy
        .execute_with_pid("sh", &["-c".to_string(), script], temp.path())
        .await;

    assert!(
        matches!(result, Err(CommandPolicyError::TimedOut { .. })),
        "expected TimedOut, got {result:?}"
    );
    let grandchild = std::fs::read_to_string(&pid_file)
        .expect("the shell records its background child's pid before the timeout")
        .trim()
        .parse::<u32>()
        .expect("the pid file holds a pid");
    assert!(
        pid_is_gone_within(grandchild, Duration::from_secs(5)).await,
        "grandchild process {grandchild} survived the timeout: the process group was not killed"
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

/// The cap is a reporting bound, not a signal: a producer that writes past it
/// must finish on its own account. Closing the pipe at the cap kills the writer
/// with `SIGPIPE`, so a command that exits 0 would be recorded as a failure —
/// this pins the drain-and-discard behaviour that replaced the early close.
#[cfg(test)]
#[cfg(unix)]
#[tokio::test]
async fn a_producer_past_the_cap_exits_zero_and_is_only_truncated() {
    let temp = crate::test_util::fresh_tempdir();
    let cap = 4096;
    // 204 800 bytes is past both the cap and a pipe buffer, so a reader that
    // closes at the cap is certain to break this producer's pipe. `dd` (unlike
    // coreutils `head`) reports the broken pipe instead of exiting 0.
    let policy = CommandPolicy::from_config(&["sh".to_string()]).with_output_cap(cap);

    let output = policy
        .execute(
            "sh",
            &[
                "-c".to_string(),
                "dd if=/dev/zero bs=8192 count=25 2>/dev/null".to_string(),
            ],
            temp.path(),
        )
        .await
        .expect("allow-listed command should run");

    assert_eq!(
        output.exit_code,
        Some(0),
        "the producer was killed instead of drained to its own exit"
    );
    assert!(
        output.success,
        "output past the cap must not turn a passing command into a failure"
    );
    assert!(
        output.truncated,
        "output exceeding cap should be marked truncated"
    );
    assert_eq!(
        output.stdout.len(),
        cap,
        "retained stdout should be exactly the cap"
    );
    assert!(output.stderr.is_empty());
}

/// The cap is a combined budget: a stream that is only stderr is still capped
/// and flagged.
#[cfg(test)]
#[tokio::test]
async fn stderr_only_output_is_capped_and_flagged() {
    let temp = crate::test_util::fresh_tempdir();
    let payload = "E".repeat(4096);

    #[cfg(windows)]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["cmd".to_string()]).with_output_cap(256),
        "cmd",
        vec!["/C".to_string(), format!("echo {payload} 1>&2")],
    );
    #[cfg(not(windows))]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["sh".to_string()]).with_output_cap(256),
        "sh",
        vec!["-c".to_string(), format!("printf %s {payload} >&2")],
    );

    let output = policy
        .execute(cmd, &args, temp.path())
        .await
        .expect("allow-listed command should run");
    assert!(
        output.truncated,
        "stderr-only output exceeding cap should be marked truncated"
    );
    assert!(
        output.stdout.is_empty(),
        "no stdout was written: {:?}",
        output.stdout
    );
    assert!(
        !output.stderr.is_empty() && output.stderr.len() <= 256,
        "stderr should be capped, got {} bytes",
        output.stderr.len()
    );
    assert!(output.stdout.len() + output.stderr.len() <= 256);
}

/// Both streams at once share the one cap, and the result still says it was cut.
#[cfg(test)]
#[tokio::test]
async fn mixed_stdout_and_stderr_share_the_combined_cap() {
    let temp = crate::test_util::fresh_tempdir();
    let payload = "M".repeat(200);

    #[cfg(windows)]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["cmd".to_string()]).with_output_cap(256),
        "cmd",
        vec![
            "/C".to_string(),
            format!("echo {payload} & echo {payload} 1>&2"),
        ],
    );
    #[cfg(not(windows))]
    let (policy, cmd, args) = (
        CommandPolicy::from_config(&["sh".to_string()]).with_output_cap(256),
        "sh",
        vec![
            "-c".to_string(),
            format!("printf %s {payload} & printf %s {payload} >&2"),
        ],
    );

    let output = policy
        .execute(cmd, &args, temp.path())
        .await
        .expect("allow-listed command should run");
    assert!(
        output.truncated,
        "combined output exceeding cap should be marked truncated"
    );
    assert!(
        !output.stdout.is_empty() && !output.stderr.is_empty(),
        "both streams wrote data, got stdout={} stderr={}",
        output.stdout.len(),
        output.stderr.len()
    );
    assert!(
        output.stdout.len() + output.stderr.len() <= 256,
        "combined output {} bytes exceeds the 256-byte cap",
        output.stdout.len() + output.stderr.len()
    );
}
