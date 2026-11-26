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
//! - Judges the **arguments** of `git`, the one allow-listed tool that names a
//!   second program through its own options: a `-c`/`--config` override whose
//!   config key names a program or hook (`alias.*`, `core.pager`, `filter.*`,
//!   …) is refused unless its value is empty — the empty value is the
//!   neutralisation form (`git -c core.fsmonitor=`) the gate-evidence path
//!   relies on — and `--exec-path` is refused outright. The allow-list bounds
//!   which programs run; an allow-listed tool may still interpret its own
//!   arguments, and this grammar narrows the one known program-naming surface.
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

#![cfg_attr(test, allow(clippy::panic, clippy::expect_used, clippy::unwrap_used))]

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::process_spawn::{split_command, ProcessError};
use warsha_core::rules::{RuleAction, RuleStore};

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
pub const SHELL_COMMANDS: &[&str] = &[
    "sh",
    "bash",
    "zsh",
    "dash",
    "ash",
    "csh",
    "tcsh",
    "fish",
    "ksh",
    "cmd",
    "powershell",
    "pwsh",
];

pub(crate) fn is_shell_command(cmd: &str) -> bool {
    let name = program_name(cmd);
    SHELL_COMMANDS.contains(&name.as_str())
}

/// `git` config keys whose value git turns into a program it runs.
///
/// A config override is a second way to name a program: `-c alias.<name>=!<cmd>`
/// makes git hand `<cmd>` to a shell, and every key here names an editor, a
/// pager, a diff/filter driver, a credential helper or a hook git launches, so
/// the allow-list would otherwise be bypassed through an allow-listed tool's
/// arguments (KEEL checkpoint finding M3). The set is the known program-naming
/// keys, not an exhaustive one, and it only matters when the value is non-empty:
/// an empty value disables the hook instead of naming a program.
pub(crate) const GIT_PROGRAM_CONFIG_KEYS: &[&str] = &[
    "core.pager",
    "core.editor",
    "editor",
    "sequence.editor",
    "interactive.difffilter",
    "core.fsmonitor",
    "core.fsmonitorhook",
    "core.fsmonitordaemon",
    "fsmonitor.allowremote",
    "fsmonitor.socketdir",
    "diff.external",
    "credential.helper",
    "core.hookspath",
    "core.attributesfile",
    "core.sshcommand",
    "core.askpass",
    "gpg.program",
    "gpg.ssh.program",
    "browser.path",
];

/// `git` config sections where every key names a program (`alias.*`, `filter.*`, `hooks.*`, `hook.*`, `pager.*`, `fsmonitor.*`).
pub(crate) const GIT_PROGRAM_CONFIG_PREFIXES: &[&str] = &[
    "alias.",
    "filter.",
    "hooks.",
    "hook.",
    "pager.",
    "fsmonitor.",
];

/// Why a `git` config override that names a program is refused.
///
/// The refusal is [`CommandPolicyError::InvalidCommand`], whose `reason` reaches
/// the agent verbatim as `ToolError::CommandRefused`; a dedicated variant would
/// need an arm in every exhaustive match over the enum, including the one in
/// `agent_tools`, which this repair does not own.
const GIT_CONFIG_PROGRAM_REASON: &str =
    "names a program or hook git would run; the allow-list bounds which programs run, and a config override is not a way around it";

/// Why `git --exec-path` is refused: it names a directory of git's executables.
const GIT_EXEC_PATH_REASON: &str =
    "points git at a directory of its own executables, which the allow-list does not admit";

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
    ("GIT_CONFIG_NOSYSTEM", "1"),
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
    ("GIT_CONFIG_NOSYSTEM", "1"),
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
    /// The command line is not admitted: it failed tokenization (e.g. an unclosed
    /// quote) or an argument is refused by an allow-listed tool's grammar.
    #[error("invalid command `{command}`: {reason}")]
    InvalidCommand {
        /// The raw command input, or the rejected argument.
        command: String,
        /// Why it was refused.
        reason: String,
    },
    /// The program token contains shell metacharacters.
    #[error("`{command}` names shell syntax rather than a program; the daemon runs a program directly with no shell, so shell syntax is refused, and the allow-list bounds which programs run — not what an allow-listed program does with its own arguments")]
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
use std::fmt;

#[derive(Clone)]
pub struct CommandPolicy {
    allowed: Vec<String>,
    rule_store: Option<Arc<dyn RuleStore>>,
    timeout: Duration,
    output_cap_bytes: usize,
}

impl fmt::Debug for CommandPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CommandPolicy")
            .field("allowed", &self.allowed)
            .field("timeout", &self.timeout)
            .field("output_cap_bytes", &self.output_cap_bytes)
            .finish()
    }
}

impl PartialEq for CommandPolicy {
    fn eq(&self, other: &Self) -> bool {
        self.allowed == other.allowed
            && self.timeout == other.timeout
            && self.output_cap_bytes == other.output_cap_bytes
    }
}
impl Eq for CommandPolicy {}

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
            rule_store: None,
            timeout: DEFAULT_COMMAND_TIMEOUT,
            output_cap_bytes: DEFAULT_OUTPUT_CAP_BYTES,
        }
    }

    /// Construct a policy with an empty allow-list that refuses every command.
    pub fn deny_all() -> Self {
        Self {
            allowed: Vec::new(),
            rule_store: None,
            timeout: DEFAULT_COMMAND_TIMEOUT,
            output_cap_bytes: DEFAULT_OUTPUT_CAP_BYTES,
        }
    }

    /// Set rule store
    pub fn with_rule_store(mut self, rule_store: Arc<dyn RuleStore>) -> Self {
        self.rule_store = Some(rule_store);
        self
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
    /// Returns the extracted first token when allowed. The remaining tokens are
    /// judged by the same argument grammar [`CommandPolicy::execute`] applies, so
    /// a pre-flight check and the execution that follows agree.
    pub fn check_command(&self, command_line: &str) -> Result<String, CommandPolicyError> {
        let (first, rest) = parse_command_line(command_line)?;
        self.check_invocation(&first, &rest)?;
        Ok(first)
    }

    /// Judge a program token and its argument list together.
    ///
    /// This is the whole judgement [`CommandPolicy::execute`] makes before it
    /// spawns, exposed so a caller that re-launches a stored command — the
    /// process manager's restart — applies the identical check instead of the
    /// program token alone.
    pub fn check_invocation(
        &self,
        program_token: &str,
        args: &[String],
    ) -> Result<(), CommandPolicyError> {
        self.check_invocation_with_workdir(program_token, args, None)
    }

    pub fn check_invocation_with_workdir(
        &self,
        program_token: &str,
        args: &[String],
        working_dir: Option<&Path>,
    ) -> Result<(), CommandPolicyError> {
        self.check_program_with_workdir(program_token, working_dir)?;
        check_arguments_with_workdir(program_token, args, working_dir)?;

        let mut current_prog = program_token;
        let mut current_args = args;
        let mut depth = 0;
        while let Some((inner_prog, inner_args)) = find_wrapped_command(current_prog, current_args)
        {
            depth += 1;
            if depth > 16 {
                return Err(CommandPolicyError::InvalidCommand {
                    command: inner_prog.to_string(),
                    reason: "nested wrapper depth exceeded".to_string(),
                });
            }
            self.check_program_with_workdir(inner_prog, working_dir)?;
            check_arguments_with_workdir(inner_prog, inner_args, working_dir)?;
            current_prog = inner_prog;
            current_args = inner_args;
        }

        if program_name(program_token) == "su" {
            for (i, arg) in args.iter().enumerate() {
                let trimmed = arg.trim().trim_matches('"').trim_matches('\'').trim();
                if trimmed == "-c" || trimmed == "--command" {
                    if let Some(cmd_str) = args.get(i + 1) {
                        if let Ok((first, _)) = parse_command_line(cmd_str) {
                            self.check_program(&first)?;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Judge a single program token against this policy.
    ///
    /// The allow-list match is on the token's **basename**, so `git`,
    /// `/usr/local/bin/git` and `./git` are one program and `/tmp/whatever/npm`
    /// is admitted with them. [`program_name`] states that rule, why it is
    /// acceptable, and what would make it unacceptable (KEEL checkpoint
    /// finding L10); the behaviour here is pinned by
    /// `allowed_commands_and_paths_pass_policy_check`.
    pub fn check_program(&self, program_token: &str) -> Result<(), CommandPolicyError> {
        self.check_program_with_workdir(program_token, None)
    }

    /// Check a program token against the policy with workspace-confinement awareness (R7-H5).
    pub fn check_program_with_workdir(
        &self,
        program_token: &str,
        working_dir: Option<&Path>,
    ) -> Result<(), CommandPolicyError> {
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

        let is_shell = SHELL_COMMANDS.contains(&program.as_str());

        // The allowlist is the hard floor: it is checked FIRST and a rule can
        // never widen it (B3 spec — rules only deny or add an ask on top).
        // R6-H2, R7-H5, R8-N3: workspace-relative executables (`./npm`, `bin/tool`)
        // and executables resolving inside the agent's workspace directory
        // never match a bare allow-list entry via basename. Furthermore, any
        // path-spelled program containing '/' or '\' must be the canonical PATH tool.
        let unquoted = trimmed.trim_matches('"').trim_matches('\'').trim();
        let is_in_ws = is_path_in_workspace(unquoted, working_dir);
        let has_separator = unquoted.contains('/') || unquoted.contains('\\');

        let is_exact = self
            .allowed
            .iter()
            .any(|entry| entry == trimmed || entry == unquoted);

        let allowed = is_exact
            || self.allowed.iter().any(|entry| {
                if is_in_ws {
                    return false;
                }
                if has_separator && working_dir.is_some() && !is_canonical_path_tool(unquoted) {
                    return false;
                }
                program_name(entry) == program
            });
        if !allowed {
            // A rule may still DENY a program the allowlist would refuse —
            // denial is recorded with the rule's reason, not the generic one.
            if let Some(ref store) = self.rule_store {
                if store.evaluate(&program) == RuleAction::Deny {
                    return Err(CommandPolicyError::NotAllowed { command: program });
                }
            }
            // Shells are refused by name, not by the missing list entry: the
            // refusal says "shell" so an edit that adds one reads as that.
            if is_shell {
                return Err(CommandPolicyError::ShellRefused { command: program });
            }
            return Err(CommandPolicyError::NotAllowed { command: program });
        }

        // Even if allow-listed by name:
        // Shells must still be refused unless explicitly in self.allowed
        if is_shell
            && !self
                .allowed
                .iter()
                .any(|entry| entry == trimmed || program_name(entry) == program)
        {
            return Err(CommandPolicyError::ShellRefused { command: program });
        }
        if is_in_ws {
            return Err(CommandPolicyError::NotAllowed { command: program });
        }

        // Inside the allowlist, owner rules can deny or ask on top of it.
        if let Some(ref store) = self.rule_store {
            match store.evaluate(&program) {
                RuleAction::Deny => {
                    return Err(CommandPolicyError::NotAllowed { command: program });
                }
                RuleAction::Ask => {
                    return Err(CommandPolicyError::InvalidCommand {
                        command: program,
                        reason: "rule engine requires approval".to_string(),
                    })
                }
                RuleAction::Allow => {}
            }
        }
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
        let (program, effective_args) = resolve_program_and_args(command, args)?;
        self.execute_resolved(&program, &effective_args, working_dir)
            .await
    }

    /// Validate and execute a command in `working_dir` under this policy, using already resolved program and args.
    pub async fn execute_resolved(
        &self,
        program: &str,
        args: &[String],
        working_dir: &Path,
    ) -> Result<CommandOutput, CommandPolicyError> {
        let (_pid, result) = self
            .execute_with_pid_resolved(program, args, working_dir)
            .await;
        result
    }

    /// Validate and execute a command, also returning the spawned OS PID when started.
    async fn execute_with_pid_resolved(
        &self,
        program: &str,
        args: &[String],
        working_dir: &Path,
    ) -> (Option<u32>, Result<CommandOutput, CommandPolicyError>) {
        if let Err(err) = self.check_invocation_with_workdir(program, args, Some(working_dir)) {
            return (None, Err(err));
        }

        let mut cmd = Command::new(program);
        cmd.args(args);
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
                        command: program.to_string(),
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
                        command: program.to_string(),
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
                        command: program.to_string(),
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
pub(crate) fn resolve_program_and_args(
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

/// Helper to extract the wrapped command and its arguments from wrapper binaries
/// like env, sudo, doas, runas, busybox, toybox, xargs, find (-exec), watch.
pub(crate) fn find_wrapped_command<'a>(
    program_token: &str,
    args: &'a [String],
) -> Option<(&'a str, &'a [String])> {
    let prog = program_name(program_token);
    match prog.as_str() {
        "busybox" | "toybox" => {
            let mut index = 0;
            while index < args.len() {
                let arg = args[index]
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim();
                if arg.starts_with('-') {
                    index += 1;
                    continue;
                }
                return Some((arg, &args[index + 1..]));
            }
            None
        }
        "env" => {
            let mut index = 0;
            while index < args.len() {
                let arg = args[index]
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim();
                let lowered = arg.to_ascii_lowercase();
                if (arg == "-u" || arg == "-C" || arg == "-S") && index + 1 < args.len() {
                    index += 2;
                    continue;
                }
                if (arg.starts_with("-u") && arg.len() > 2)
                    || (arg.starts_with("-C") && arg.len() > 2)
                    || (arg.starts_with("-S") && arg.len() > 2)
                    || lowered.starts_with("--unset=")
                    || lowered.starts_with("--chdir=")
                    || lowered.starts_with("--split-string=")
                {
                    index += 1;
                    continue;
                }
                if arg.starts_with('-') {
                    index += 1;
                    continue;
                }
                if arg.contains('=') {
                    index += 1;
                    continue;
                }
                return Some((arg, &args[index + 1..]));
            }
            None
        }
        "sudo" | "doas" | "runas" => {
            let mut index = 0;
            while index < args.len() {
                let arg = args[index]
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim();
                if (arg == "-u" || arg == "-g" || arg == "-p" || arg == "-C")
                    && index + 1 < args.len()
                {
                    index += 2;
                    continue;
                }
                if arg.starts_with('-') {
                    index += 1;
                    continue;
                }
                return Some((arg, &args[index + 1..]));
            }
            None
        }
        "xargs" => {
            let mut index = 0;
            while index < args.len() {
                let arg = args[index]
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim();
                if (arg == "-I"
                    || arg == "-i"
                    || arg == "-n"
                    || arg == "-P"
                    || arg == "-d"
                    || arg == "-s"
                    || arg == "-E"
                    || arg == "-L")
                    && index + 1 < args.len()
                {
                    index += 2;
                    continue;
                }
                if arg.starts_with('-') {
                    index += 1;
                    continue;
                }
                return Some((arg, &args[index + 1..]));
            }
            None
        }
        "find" => {
            let mut index = 0;
            while index < args.len() {
                let arg = args[index]
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim();
                let lowered = arg.to_ascii_lowercase();
                if lowered == "-exec"
                    || lowered == "-execdir"
                    || lowered == "-ok"
                    || lowered == "-okdir"
                {
                    if let Some(cmd) = args.get(index + 1) {
                        let cmd_clean = cmd.trim().trim_matches('"').trim_matches('\'').trim();
                        return Some((cmd_clean, &args[index + 2..]));
                    }
                }
                index += 1;
            }
            None
        }
        "watch" => {
            let mut index = 0;
            while index < args.len() {
                let arg = args[index]
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim();
                if (arg == "-n" || arg == "--interval") && index + 1 < args.len() {
                    index += 2;
                    continue;
                }
                if arg.starts_with('-') {
                    index += 1;
                    continue;
                }
                return Some((arg, &args[index + 1..]));
            }
            None
        }
        _ => None,
    }
}

/// Check if an argument to sqlite3 attempts command execution (.shell, .system, .once/.output with pipe, -init, --init, .read, .import, .load).
/// Supports full and prefix forms (e.g. .sh, .she, .shel, .sy, .sys, .syst, .re, .rea, .im, .imp, .lo, .loa).
pub(crate) fn is_risky_sqlite3_arg(arg: &str, next_arg: Option<&str>) -> bool {
    let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
    let lowered = clean.to_ascii_lowercase();

    if lowered == "-init"
        || lowered.starts_with("-init=")
        || lowered == "--init"
        || lowered.starts_with("--init=")
    {
        return true;
    }

    if lowered.starts_with(".once") || lowered.starts_with(".output") {
        let next_is_pipe = next_arg
            .map(|a| {
                a.trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim()
                    .starts_with('|')
            })
            .unwrap_or(false);
        if lowered.contains('|') || next_is_pipe {
            return true;
        }
    }

    for part in lowered.split(';') {
        let trimmed_part = part.trim();
        if let Some(cmd) = trimmed_part.strip_prefix('.') {
            let first_token = cmd.split_whitespace().next().unwrap_or(cmd);
            if first_token.starts_with("sh")
                || first_token.starts_with("sy")
                || first_token.starts_with("re")
                || first_token.starts_with("im")
                || first_token.starts_with("lo")
            {
                return true;
            }
        }
    }

    false
}

/// Judge the arguments of a program for a second program named through them.
///
/// The allow-list bounds which **programs** run; it cannot bound what an
/// allow-listed tool does with its own arguments (`node -e`, `npm run`, `cargo
/// test` all run project code by design). `git` is the one allow-listed tool
/// whose plain options name another program — a config override, or the
/// directory of git's own executables — so its grammar is narrowed here: an
/// override whose key names a program or hook is refused unless its value is
/// empty, and `--exec-path` is refused outright (KEEL checkpoint finding M3).
fn check_arguments_with_workdir(
    program: &str,
    args: &[String],
    working_dir: Option<&Path>,
) -> Result<(), CommandPolicyError> {
    // Programs containing path separators that resolve inside the agent's workspace directory
    // must never run without approval (R7-H5).
    if let Some(wd) = working_dir {
        let clean = program.trim().trim_matches('"').trim_matches('\'').trim();
        if (clean.contains('/') || clean.contains('\\')) && path_resolves_inside_dir(clean, wd) {
            return Err(CommandPolicyError::NotAllowed {
                command: program.to_string(),
            });
        }
    }

    // N-2: Refuse GIT_WORK_TREE / GIT_DIR / GIT_NAMESPACE env passthrough
    for arg in args {
        let a_low = arg
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim()
            .to_ascii_lowercase();
        if a_low.starts_with("git_work_tree=")
            || a_low.starts_with("git_dir=")
            || a_low.starts_with("git_namespace=")
        {
            return Err(CommandPolicyError::InvalidCommand {
                command: arg.clone(),
                reason: "GIT_WORK_TREE/GIT_DIR/GIT_NAMESPACE environment variables are not allowed"
                    .to_string(),
            });
        }
    }

    // N-3: Refuse --output, -o, --work-tree targets resolving outside workspace
    for (i, arg) in args.iter().enumerate() {
        let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
        let lowered = clean.to_ascii_lowercase();

        let (flag, val) = if let Some((f, v)) = clean.split_once('=') {
            (f.to_ascii_lowercase(), Some(v))
        } else {
            (lowered.clone(), None)
        };

        if flag == "--output" || flag == "-o" || flag == "--work-tree" {
            let target_val = if let Some(v) = val {
                Some(v)
            } else {
                args.get(i + 1).map(|s| s.as_str())
            };
            if let Some(tv) = target_val {
                if is_outside_workspace_path(tv, working_dir) {
                    return Err(CommandPolicyError::InvalidCommand {
                        command: arg.clone(),
                        reason: format!("argument `{tv}` resolves outside workspace"),
                    });
                }
            }
        }
    }

    let prog = program_name(program);
    let is_git = prog == "git";
    let mut skip_next = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if is_git && (arg == "-m" || arg == "--message") {
            skip_next = true;
            continue;
        }
        if is_git && (arg.starts_with("-m") || arg.starts_with("--message=")) {
            continue;
        }
        if is_git_config_path(arg) {
            return Err(CommandPolicyError::InvalidCommand {
                command: arg.clone(),
                reason: "direct writes or references to .git/config are not allowed".to_string(),
            });
        }
    }

    if prog == "sqlite3" {
        for (i, arg) in args.iter().enumerate() {
            if is_risky_sqlite3_arg(arg, args.get(i + 1).map(|s| s.as_str())) {
                return Err(CommandPolicyError::InvalidCommand {
                    command: arg.clone(),
                    reason: "sqlite3 command execution is not allowed".to_string(),
                });
            }
        }
        return Ok(());
    }

    if prog == "go" {
        for arg in args {
            let lowered = arg
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_ascii_lowercase();
            if lowered.starts_with("-toolexec")
                || lowered.starts_with("--toolexec")
                || lowered.starts_with("-vettool")
                || lowered.starts_with("--vettool")
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: arg.clone(),
                    reason: "go -toolexec / -vettool is not allowed".to_string(),
                });
            }
        }
    }

    if prog == "find" {
        for (i, arg) in args.iter().enumerate() {
            let trimmed = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = trimmed.to_ascii_lowercase();
            if lowered == "-exec"
                || lowered == "-execdir"
                || lowered == "-ok"
                || lowered == "-okdir"
            {
                if let Some(next_arg) = args.get(i + 1) {
                    if is_shell_command(next_arg) {
                        return Err(CommandPolicyError::ShellRefused {
                            command: next_arg.to_string(),
                        });
                    }
                }
                return Err(CommandPolicyError::InvalidCommand {
                    command: trimmed.to_string(),
                    reason: "find -exec is not allowed".to_string(),
                });
            }
        }
        return Ok(());
    }

    if prog == "su" {
        for (i, arg) in args.iter().enumerate() {
            let trimmed = arg.trim().trim_matches('"').trim_matches('\'').trim();
            if trimmed == "-c" || trimmed == "--command" {
                if let Some(cmd_str) = args.get(i + 1) {
                    if let Ok((first, r)) = parse_command_line(cmd_str) {
                        if is_shell_command(&first) {
                            return Err(CommandPolicyError::ShellRefused { command: first });
                        }
                        check_arguments_with_workdir(&first, &r, working_dir)?;
                    }
                }
            }
        }
        return Err(CommandPolicyError::ShellRefused {
            command: "su".to_string(),
        });
    }

    if let Some((inner_prog, inner_args)) = find_wrapped_command(program, args) {
        if is_shell_command(inner_prog) {
            return Err(CommandPolicyError::ShellRefused {
                command: inner_prog.to_string(),
            });
        }
        return check_arguments_with_workdir(inner_prog, inner_args, working_dir);
    }

    if prog != "git" {
        return Ok(());
    }

    // N-1: Bare-repo-shaped workspace without .git dir refuses ANY git invocation
    if let Some(wd) = working_dir {
        if is_bare_repo_shape(wd) {
            return Err(CommandPolicyError::InvalidCommand {
                command: format!("git {}", args.join(" ")),
                reason: "git invocations in bare-repo-shaped workspace without .git directory are not allowed"
                    .to_string(),
            });
        }
    }

    let mut index = 0;
    let mut subcommand_found = false;
    while index < args.len() {
        let argument = args[index].trim();
        let lowered = argument.to_ascii_lowercase();

        // Check for --exec-path anywhere
        if lowered == "--exec-path" || lowered.starts_with("--exec-path=") {
            return Err(CommandPolicyError::InvalidCommand {
                command: argument.to_string(),
                reason: GIT_EXEC_PATH_REASON.to_string(),
            });
        }

        // Check for --upload-pack / --receive-pack anywhere
        if lowered == "--upload-pack"
            || lowered.starts_with("--upload-pack=")
            || lowered == "--receive-pack"
            || lowered.starts_with("--receive-pack=")
        {
            return Err(CommandPolicyError::InvalidCommand {
                command: argument.to_string(),
                reason: "git --upload-pack / --receive-pack is not allowed".to_string(),
            });
        }

        // Check for ext:: transport anywhere (R6-H1)
        if lowered.starts_with("ext::") {
            return Err(CommandPolicyError::InvalidCommand {
                command: argument.to_string(),
                reason: "git ext:: transport is not allowed".to_string(),
            });
        }

        // Check for --git-dir anywhere (R8-N2)
        if lowered == "--git-dir" {
            if let Some(target) = args.get(index + 1) {
                if !is_valid_git_dir(target, working_dir) {
                    return Err(CommandPolicyError::InvalidCommand {
                        command: argument.to_string(),
                        reason: "git --git-dir with alternate git directory is not allowed"
                            .to_string(),
                    });
                }
                index += 2;
                continue;
            } else {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git --git-dir requires an argument".to_string(),
                });
            }
        }
        if lowered.starts_with("--git-dir=") {
            let target = &argument["--git-dir=".len()..];
            if !is_valid_git_dir(target, working_dir) {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git --git-dir with alternate git directory is not allowed".to_string(),
                });
            }
            index += 1;
            continue;
        }

        // Check for --work-tree anywhere (R8-N2)
        if lowered == "--work-tree" {
            if let Some(target) = args.get(index + 1) {
                if !is_valid_work_tree(target, working_dir) {
                    return Err(CommandPolicyError::InvalidCommand {
                        command: argument.to_string(),
                        reason: "git --work-tree with alternate work tree is not allowed"
                            .to_string(),
                    });
                }
                index += 2;
                continue;
            } else {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git --work-tree requires an argument".to_string(),
                });
            }
        }
        if lowered.starts_with("--work-tree=") {
            let target = &argument["--work-tree=".len()..];
            if !is_valid_work_tree(target, working_dir) {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git --work-tree with alternate work tree is not allowed".to_string(),
                });
            }
            index += 1;
            continue;
        }

        // Check for --namespace / --super-prefix anywhere (R8-N2)
        if lowered == "--namespace" || lowered.starts_with("--namespace=") {
            return Err(CommandPolicyError::InvalidCommand {
                command: argument.to_string(),
                reason: "git --namespace is not allowed".to_string(),
            });
        }
        if lowered == "--super-prefix" || lowered.starts_with("--super-prefix=") {
            return Err(CommandPolicyError::InvalidCommand {
                command: argument.to_string(),
                reason: "git --super-prefix is not allowed".to_string(),
            });
        }

        // Check for -c, --config, --config-env overrides anywhere
        if argument == "-c" || lowered == "--config" || lowered == "--config-env" {
            if let Some(value) = args.get(index + 1) {
                check_git_config_override(value)?;
                index += 2;
                continue;
            }
        } else if let Some(value) = git_config_override_value(argument) {
            check_git_config_override(value)?;
            index += 1;
            continue;
        }

        // Check global options before the subcommand
        if !subcommand_found {
            if lowered == "--bare" {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git --bare is not allowed".to_string(),
                });
            }

            if argument == "-C" {
                if let Some(target) = args.get(index + 1) {
                    let clean_target = target.trim().trim_matches('"').trim_matches('\'').trim();
                    let is_current = clean_target == "." || clean_target == "./";
                    let is_work_dir = working_dir.is_some_and(|wd| {
                        Path::new(clean_target) == wd || clean_target == wd.to_string_lossy()
                    });
                    if !is_current && !is_work_dir {
                        return Err(CommandPolicyError::InvalidCommand {
                            command: argument.to_string(),
                            reason: "git -C with target other than . is not allowed".to_string(),
                        });
                    }
                }
                index += 2;
                continue;
            }
            if argument.starts_with("-C") && argument.len() > 2 {
                let target = &argument[2..];
                let clean_target = target.trim().trim_matches('"').trim_matches('\'').trim();
                let is_current = clean_target == "." || clean_target == "./";
                let is_work_dir = working_dir.is_some_and(|wd| {
                    Path::new(clean_target) == wd || clean_target == wd.to_string_lossy()
                });
                if !is_current && !is_work_dir {
                    return Err(CommandPolicyError::InvalidCommand {
                        command: argument.to_string(),
                        reason: "git -C with target other than . is not allowed".to_string(),
                    });
                }
                index += 1;
                continue;
            }

            if argument.starts_with('-') {
                index += 1;
                continue;
            }

            subcommand_found = true;
            let remaining = &args[index + 1..];

            if lowered == "apply" {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git apply is not allowed (can set executable bit)".to_string(),
                });
            }

            if lowered == "filter-branch" {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git filter-branch is not allowed".to_string(),
                });
            }

            if (lowered == "init" || lowered == "clone")
                && remaining.iter().any(|a| {
                    let clean_a = a.trim().trim_matches('"').trim_matches('\'').trim();
                    let a_low = clean_a.to_ascii_lowercase();
                    a_low == "--template" || a_low.starts_with("--template=")
                })
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git init/clone --template is not allowed".to_string(),
                });
            }

            if lowered == "fetch-pack"
                && remaining.iter().any(|a| {
                    let clean_a = a.trim().trim_matches('"').trim_matches('\'').trim();
                    let a_low = clean_a.to_ascii_lowercase();
                    a_low == "--exec"
                        || a_low.starts_with("--exec=")
                        || a_low.starts_with("--upload-pack")
                        || clean_a == "-u"
                })
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git fetch-pack --exec is not allowed".to_string(),
                });
            }

            if (lowered == "ls-remote" || lowered == "fetch" || lowered == "clone")
                && remaining.iter().any(|a| {
                    let clean_a = a.trim().trim_matches('"').trim_matches('\'').trim();
                    clean_a == "-u"
                        || (clean_a.starts_with("-u") && clean_a.len() > 2)
                        || clean_a.starts_with("--upload-pack")
                })
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git --upload-pack is not allowed".to_string(),
                });
            }

            if lowered == "grep"
                && remaining.iter().any(|a| {
                    let a_clean = a.trim().trim_matches('"').trim_matches('\'').trim();
                    let a_low = a_clean.to_ascii_lowercase();
                    a_clean == "-O"
                        || (a_clean.starts_with("-O") && a_clean.len() > 2)
                        || a_low == "--open-files-in-pager"
                        || a_low.starts_with("--open-files-in-pager=")
                })
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git grep -O / --open-files-in-pager is not allowed".to_string(),
                });
            }

            if lowered == "difftool"
                && remaining.iter().any(|a| {
                    let a_clean = a.trim().trim_matches('"').trim_matches('\'').trim();
                    let a_low = a_clean.to_ascii_lowercase();
                    a_clean == "-x"
                        || (a_clean.starts_with("-x") && a_clean.len() > 2)
                        || a_low == "--extcmd"
                        || a_low.starts_with("--extcmd=")
                })
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git difftool -x / --extcmd is not allowed".to_string(),
                });
            }

            if lowered == "rebase"
                && remaining.iter().any(|a| {
                    let a_low = a.trim().to_ascii_lowercase();
                    a_low == "-x" || a_low == "--exec" || a_low.starts_with("--exec=")
                })
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git rebase -x is not allowed".to_string(),
                });
            }

            if lowered == "submodule"
                && remaining
                    .iter()
                    .any(|a| a.trim().eq_ignore_ascii_case("foreach"))
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git submodule foreach is not allowed".to_string(),
                });
            }

            if lowered == "bisect"
                && remaining
                    .iter()
                    .any(|a| a.trim().eq_ignore_ascii_case("run"))
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git bisect run is not allowed".to_string(),
                });
            }

            if lowered == "archive"
                && remaining.iter().any(|a| {
                    let a_low = a.trim().to_ascii_lowercase();
                    a_low == "--exec" || a_low.starts_with("--exec=")
                })
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: argument.to_string(),
                    reason: "git archive --exec is not allowed".to_string(),
                });
            }

            if lowered == "config" {
                check_git_config_subcommand(remaining)?;
            }
        }

        index += 1;
    }
    Ok(())
}

fn check_git_config_subcommand(args: &[String]) -> Result<(), CommandPolicyError> {
    for arg in args {
        let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
        if clean.contains('=') {
            if is_risky_git_config(clean) {
                return Err(CommandPolicyError::InvalidCommand {
                    command: clean.to_string(),
                    reason: format!("git config `{clean}` {GIT_CONFIG_PROGRAM_REASON}"),
                });
            } else {
                return Err(CommandPolicyError::InvalidCommand {
                    command: clean.to_string(),
                    reason: "git config writes are not allowed".to_string(),
                });
            }
        }
    }

    let mut positional = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].trim().trim_matches('"').trim_matches('\'').trim();
        if arg == "--file" || arg == "-f" || arg == "--blob" {
            i += 2;
            continue;
        }
        if arg.starts_with('-') {
            let lowered = arg.to_ascii_lowercase();
            if lowered == "--unset"
                || lowered == "--unset-all"
                || lowered == "--add"
                || lowered == "--replace-all"
            {
                return Err(CommandPolicyError::InvalidCommand {
                    command: arg.to_string(),
                    reason: "git config writes are not allowed".to_string(),
                });
            }
            i += 1;
            continue;
        }
        positional.push(arg);
        i += 1;
    }

    if !positional.is_empty() {
        let first = positional[0];
        if first.eq_ignore_ascii_case("set") {
            if positional.len() >= 3 {
                let key = positional[1];
                let val = positional[2];
                let paired = format!("{key}={val}");
                if is_risky_git_config(&paired) {
                    return Err(CommandPolicyError::InvalidCommand {
                        command: paired,
                        reason: format!("git config `{key}` {GIT_CONFIG_PROGRAM_REASON}"),
                    });
                }
            }
            return Err(CommandPolicyError::InvalidCommand {
                command: first.to_string(),
                reason: "git config writes are not allowed".to_string(),
            });
        } else if first.eq_ignore_ascii_case("unset") {
            return Err(CommandPolicyError::InvalidCommand {
                command: first.to_string(),
                reason: "git config writes are not allowed".to_string(),
            });
        } else if positional.len() >= 2 {
            let key = positional[0];
            let val = positional[1];
            let paired = format!("{key}={val}");
            if is_risky_git_config(&paired) {
                return Err(CommandPolicyError::InvalidCommand {
                    command: paired,
                    reason: format!("git config `{key}` {GIT_CONFIG_PROGRAM_REASON}"),
                });
            }
            return Err(CommandPolicyError::InvalidCommand {
                command: paired,
                reason: "git config writes are not allowed".to_string(),
            });
        }
    }

    Ok(())
}

/// Whether a path points to `.git/config` directly or points into `.git`.
///
/// Normalizes redundant slashes, dot-segments, Windows backslashes, and compares
/// case-insensitively (e.g. `.git/config`, `.git//config`, `.git/./config`, `.GIT/config`).
/// Fixes R5-L1 over-match: does not match innocent arguments like `fix-.git/config-handling`.
pub(crate) fn is_git_config_path(path: &str) -> bool {
    let clean = path.trim().trim_matches('"').trim_matches('\'').trim();
    if clean.is_empty() {
        return false;
    }
    let target = if let Some((flag, val)) = clean.split_once('=') {
        if flag.starts_with('-') {
            val.trim().trim_matches('"').trim_matches('\'').trim()
        } else {
            clean
        }
    } else {
        clean
    };

    let normalized = target.replace('\\', "/");
    let segments: Vec<&str> = normalized
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();

    if segments.is_empty() {
        return false;
    }

    for (i, seg) in segments.iter().enumerate() {
        if seg.eq_ignore_ascii_case(".git") && i + 1 < segments.len() {
            let rest_first = segments[i + 1].to_ascii_lowercase();
            if rest_first.starts_with("config")
                || rest_first == "hooks"
                || rest_first == "worktrees"
                || rest_first == "head"
                || rest_first == "index"
                || rest_first == "objects"
                || rest_first == "refs"
                || rest_first == "info"
            {
                return true;
            }
        }
    }

    false
}

/// The `key=value` an attached `-c…`, `--config=…` or `--config-env=…` token carries.
///
/// The separate-token forms (`-c key=value`) are read by the caller, so a token
/// that starts with `-c` here is the attached form.
pub(crate) fn git_config_override_value(argument: &str) -> Option<&str> {
    let clean = argument.trim().trim_matches('"').trim_matches('\'').trim();
    if let Some(rest) = clean.strip_prefix("-c") {
        return Some(rest.trim_start());
    }
    let lowered = clean.to_ascii_lowercase();
    for prefix in ["--config=", "--config-env=", "--config ", "--config-env "] {
        if lowered.starts_with(prefix) {
            return Some(clean[prefix.len()..].trim_start());
        }
    }
    None
}

/// Whether a git config key is on the safe allow-list of inert keys (R7-H2/H3/H4).
///
/// Only pure display, formatting, metadata and inert configuration options are admitted.
/// Command-executing keys, template directories, transport/hook configurations, and include
/// directives are excluded and classify as Risky.
pub fn is_allowed_git_config_key(key: &str) -> bool {
    let normalized = key.trim().to_ascii_lowercase();

    // Exact inert display / formatting / safety keys
    const EXACT_SAFE_KEYS: &[&str] = &[
        "core.quotepath",
        "core.abbrev",
        "core.autocrlf",
        "core.filemode",
        "core.eol",
        "core.safecrlf",
        "core.ignorecase",
        "core.checkstat",
        "core.trustctime",
        "core.precomposeunicode",
        "core.symlinks",
        "push.default",
        "pull.ff",
        "pull.rebase",
        "init.defaultbranch",
        "diff.renames",
        "diff.algorithm",
        "diff.mnemonicprefix",
        "merge.conflictstyle",
        "format.pretty",
    ];

    if EXACT_SAFE_KEYS.contains(&normalized.as_str()) {
        return true;
    }

    // Prefixes for namespaces known to be pure display or metadata:
    if normalized.starts_with("user.") {
        return true;
    }

    if normalized.starts_with("color.") {
        return true;
    }

    if normalized.starts_with("status.") {
        return true;
    }

    if normalized.starts_with("log.") {
        return true;
    }

    if normalized.starts_with("i18n.") {
        return true;
    }

    if normalized.starts_with("advice.") {
        return true;
    }

    false
}

/// Whether a git config key can execute programs (alias, fsmonitor, proxies, hooks, textconv, drivers, etc.).
#[allow(dead_code)]
pub(crate) fn is_program_running_key(normalized_key: &str) -> bool {
    normalized_key.starts_with("alias.")
        || normalized_key.starts_with("include.")
        || normalized_key.starts_with("includeif.")
        || normalized_key.starts_with("protocol.")
        || normalized_key.contains("fsmonitor")
        || normalized_key.contains("proxy")
        || normalized_key.contains("hook")
        || normalized_key.contains("textconv")
        || normalized_key.contains("driver")
        || GIT_PROGRAM_CONFIG_KEYS.contains(&normalized_key)
        || GIT_PROGRAM_CONFIG_PREFIXES
            .iter()
            .any(|prefix| normalized_key.starts_with(prefix))
}

/// Check whether a git config string `key=value` overrides a non-allowlisted key with a non-empty value (R7-H2/H3/H4).
///
/// An **empty** value neutralises the setting (e.g. `core.fsmonitor=`), which is safe.
/// Any non-empty value for a key not on the allow-list is considered risky.
pub(crate) fn is_risky_git_config(value: &str) -> bool {
    let clean = value.trim().trim_matches('"').trim_matches('\'').trim();
    let Some((key, config_value)) = clean.split_once('=') else {
        return false;
    };
    let config_val_trimmed = config_value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim();
    if config_val_trimmed.is_empty() {
        return false;
    }
    let key = key.trim().trim_matches('"').trim_matches('\'').trim();
    !is_allowed_git_config_key(key)
}

/// Refuse a `git` config override whose key names a program and whose value is set.
///
/// An **empty** value names no program — it disables the hook — which is the
/// neutralisation the gate-evidence path relies on (`git -c core.fsmonitor=
/// diff --no-ext-diff`), so that form stays allowed.
fn check_git_config_override(value: &str) -> Result<(), CommandPolicyError> {
    let clean = value.trim().trim_matches('"').trim_matches('\'').trim();
    let Some((key, config_value)) = clean.split_once('=') else {
        // Without a `=` there is no value, so git itself refuses the override.
        return Ok(());
    };
    let config_val_trimmed = config_value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim();
    if config_val_trimmed.is_empty() {
        return Ok(());
    }
    let key = key.trim().trim_matches('"').trim_matches('\'').trim();
    if is_risky_git_config(value) {
        return Err(CommandPolicyError::InvalidCommand {
            command: value.to_string(),
            reason: format!("git config key `{key}` {GIT_CONFIG_PROGRAM_REASON}"),
        });
    }
    Ok(())
}

/// Check if a path resolves inside the given directory using canonicalization.
pub(crate) fn path_resolves_inside_dir(path_str: &str, dir: &Path) -> bool {
    let clean = path_str.trim().trim_matches('"').trim_matches('\'').trim();
    if clean.is_empty() {
        return false;
    }
    let p = Path::new(clean);
    let resolved = if p.is_absolute() {
        p.to_path_buf()
    } else {
        dir.join(p)
    };
    let canonical_dir = match dir.canonicalize() {
        Ok(cd) => cd,
        Err(_) => return false,
    };
    let to_check = if resolved.exists() {
        resolved.canonicalize().ok()
    } else {
        resolved
            .parent()
            .and_then(|parent| parent.canonicalize().ok())
            .map(|parent| {
                if let Some(file_name) = resolved.file_name() {
                    parent.join(file_name)
                } else {
                    parent
                }
            })
    };
    if let Some(target) = to_check {
        target.starts_with(&canonical_dir)
    } else {
        false
    }
}

/// Whether a program token represents a workspace-relative path (e.g. `./npm`, `bin/tool`, `sub/tool`).
///
/// Workspace-relative paths never match bare allow-list entries by basename (R6-H2)
/// because an agent could author executable files in the workspace (e.g. via `git apply`)
/// and invoke them without approval.
pub fn is_workspace_relative_path(path: &str) -> bool {
    let clean = path.trim().trim_matches('"').trim_matches('\'').trim();
    if !clean.contains('/') && !clean.contains('\\') {
        return false;
    }
    if clean.starts_with('/') || clean.starts_with('\\') {
        return false;
    }
    // Windows drive root: e.g. "C:\" or "c:/"
    let bytes = clean.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
    {
        return false;
    }
    true
}

/// Whether a program token represents a path that resolves inside the workspace (R7-H5).
///
/// Workspace-relative paths (`./npm`, `bin/tool`) and absolute paths resolving inside
/// the agent's workspace directory must never match bare allow-list entries by basename.
pub fn is_path_in_workspace(path_str: &str, working_dir: Option<&Path>) -> bool {
    if is_workspace_relative_path(path_str) {
        return true;
    }
    let clean = path_str.trim().trim_matches('"').trim_matches('\'').trim();
    if clean.contains('/') || clean.contains('\\') {
        if let Some(wd) = working_dir {
            return path_resolves_inside_dir(clean, wd);
        }
    }
    false
}

/// Returns true if `program_token` names the canonical PATH-resolved binary for its basename (R8-N3).
pub(crate) fn is_canonical_path_tool(program_token: &str) -> bool {
    let clean = program_token
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim();
    let prog = program_name(clean);
    if prog.is_empty() {
        return false;
    }
    let Ok(token_canonical) = Path::new(clean).canonicalize() else {
        return false;
    };
    for path_dir in std::env::split_paths(&child_path()) {
        let candidate = path_dir.join(&prog);
        #[cfg(windows)]
        let candidates = [
            candidate.clone(),
            path_dir.join(format!("{prog}.exe")),
            path_dir.join(format!("{prog}.cmd")),
            path_dir.join(format!("{prog}.bat")),
        ];
        #[cfg(not(windows))]
        let candidates = [candidate];

        for cand in candidates {
            if cand.is_file() {
                if let Ok(cand_canonical) = cand.canonicalize() {
                    if cand_canonical == token_canonical {
                        return true;
                    }
                }
                return false;
            }
        }
    }
    false
}

/// Returns true if `dir` has the layout of a bare repository (HEAD + objects/ + refs/)
/// without a `.git/` directory (R8-N1).
pub(crate) fn is_bare_repo_shape(dir: &Path) -> bool {
    let has_dot_git = dir.join(".git").exists();
    if has_dot_git {
        return false;
    }
    let has_head = dir.join("HEAD").exists();
    let has_objects = dir.join("objects").is_dir();
    let has_refs = dir.join("refs").is_dir();
    has_head && has_objects && has_refs
}

/// Returns true if `target` safely represents the workspace root itself (and not `.git` or outside) (R8-N2).
pub(crate) fn is_valid_work_tree(target: &str, working_dir: Option<&Path>) -> bool {
    let clean = target.trim().trim_matches('"').trim_matches('\'').trim();
    if clean.is_empty() {
        return false;
    }
    let norm = clean.replace('\\', "/");
    if norm == ".git"
        || norm == "./.git"
        || norm == ".git/"
        || norm == "./.git/"
        || norm.split('/').any(|s| s == ".git")
    {
        return false;
    }
    if norm == "." || norm == "./" {
        return true;
    }
    if let Some(wd) = working_dir {
        if Path::new(clean) == wd {
            return true;
        }
        if let (Ok(clean_can), Ok(wd_can)) = (Path::new(clean).canonicalize(), wd.canonicalize()) {
            return clean_can == wd_can;
        }
    }
    false
}

/// Returns true if `target` safely represents the standard `.git` directory for the workspace (R8-N2).
pub(crate) fn is_valid_git_dir(target: &str, working_dir: Option<&Path>) -> bool {
    let clean = target.trim().trim_matches('"').trim_matches('\'').trim();
    if clean.is_empty() {
        return false;
    }
    let norm = clean.replace('\\', "/");
    if norm == ".git" || norm == "./.git" || norm == ".git/" || norm == "./.git/" {
        return true;
    }
    if let Some(wd) = working_dir {
        let expected = wd.join(".git");
        if Path::new(clean) == expected {
            return true;
        }
        if let (Ok(clean_can), Ok(exp_can)) =
            (Path::new(clean).canonicalize(), expected.canonicalize())
        {
            return clean_can == exp_can;
        }
    }
    false
}

/// Returns true if `path_str` is a path resolving outside the workspace working directory (R8-N3).
pub(crate) fn is_outside_workspace_path(path_str: &str, working_dir: Option<&Path>) -> bool {
    let clean = path_str.trim().trim_matches('"').trim_matches('\'').trim();
    if clean.is_empty() {
        return false;
    }
    let has_traversal = clean.contains("..");
    let is_abs = clean.starts_with('/')
        || clean.starts_with('\\')
        || (clean.len() >= 2
            && clean.as_bytes()[1] == b':'
            && (clean.as_bytes()[0] as char).is_ascii_alphabetic());
    if !is_abs && !has_traversal {
        return false;
    }
    let p = Path::new(clean);
    if let Some(wd) = working_dir {
        let resolved = if p.is_absolute() {
            p.to_path_buf()
        } else {
            wd.join(p)
        };
        let mut normalized = PathBuf::new();
        for component in resolved.components() {
            match component {
                std::path::Component::ParentDir => {
                    normalized.pop();
                }
                std::path::Component::CurDir => {}
                c => normalized.push(c),
            }
        }
        let wd_norm: PathBuf = {
            let mut n = PathBuf::new();
            for c in wd.components() {
                match c {
                    std::path::Component::ParentDir => {
                        n.pop();
                    }
                    std::path::Component::CurDir => {}
                    comp => n.push(comp),
                }
            }
            n
        };
        !normalized.starts_with(&wd_norm)
    } else {
        true
    }
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
///
/// **The allow-list matches on this basename, and that is deliberate** (KEEL
/// checkpoint finding L10). `check_program` admits a token when its basename is
/// an allow-list entry, so `git`, `/usr/local/bin/git` and `./git` are one
/// program, and `/tmp/whatever/npm` is admitted for the same reason: the
/// allow-listed toolchains are resolved out of the owner's `PATH`, and the
/// directory a `PATH` lookup lands in is not the daemon's to name. The pin for
/// the rule is `allowed_commands_and_paths_pass_policy_check`, which asserts a
/// quoted absolute path and `./git` both pass; changing the rule means changing
/// that test first, on purpose.
///
/// Why the rule is acceptable as written:
///
/// - The allow-list bounds **which programs** run, not what an allow-listed
///   program does with its own arguments: `node -e`, `npm run` and `cargo test`
///   execute code the agent wrote by design (see `check_arguments`), so spelling
///   one of those as a path grants nothing a bare name does not.
/// - The executor's only write tool writes content inside its working directory
///   and cannot set an executable bit (`agent_tools.rs`, `write_file`: the path
///   goes through the same screen that refuses absolute paths and `..`, then a
///   plain `std::fs::write`). A path-spelled allow-listed name is therefore a
///   program that was already there where the owner put it, not one the agent
///   authored. Overwriting a *pre-existing* executable whose basename matches an
///   entry is the one way to put agent-authored code behind an allowed name, and
///   it grants nothing the allow-list does not already grant for the reason
///   above.
/// - A `..` in the token is refused before this comparison
///   (`has_parent_traversal`), so a basename match cannot climb out of the
///   directory the token names.
///
/// What would make it unacceptable, and must be re-reviewed before it happens:
/// a tool that can create an executable bit (a `chmod`, a copy of an existing
/// binary, a downloaded artifact) — the agent could then author
/// `/tmp/whatever/npm` itself; or an allow-list entry that is not a general
/// code-executing toolchain, where substituting a different program for the named
/// one would not be equivalent to what the entry already permits.
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
    // R6-H2: workspace-relative executable does not match bare allow-list entry
    assert!(policy.check_command("./git status").is_err());
    assert!(policy.check_command("./npm --version").is_err());
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

/// The refused argument and the policy's reason for it.
///
/// A `git` refusal travels as [`CommandPolicyError::InvalidCommand`], the variant
/// whose `reason` the agent-facing `ToolError` carries verbatim.
#[cfg(test)]
#[allow(clippy::panic)]
fn refused_argument(error: &CommandPolicyError) -> (&str, &str) {
    match error {
        CommandPolicyError::InvalidCommand { command, reason } => (command, reason),
        other => panic!("expected a policy refusal, got {other:?}"),
    }
}

/// KEEL checkpoint finding M3, the live form: `git -c 'alias.x=!echo escaped' x`
/// makes git hand `echo escaped` to a shell, so an allow-listed tool reaches a
/// program the allow-list never admitted. The refusal names the config key, the
/// execution path refuses it too, and the empty value (which disables the alias
/// instead of naming a program) still passes.
#[cfg(test)]
#[tokio::test]
async fn a_git_alias_override_that_names_a_program_is_refused() {
    let policy = CommandPolicy::from_config(&["git".to_string()]);
    let temp = crate::test_util::fresh_tempdir();

    let escape = "git -c 'alias.x=!echo escaped' x";
    let err = policy
        .check_command(escape)
        .expect_err("an alias override that names a program must be refused");
    let (rejected, reason) = refused_argument(&err);
    assert!(
        rejected.contains("alias.x"),
        "the rejected argument is named: {rejected}"
    );
    assert!(
        reason.contains("alias.x"),
        "the refusal must name the config key: {reason}"
    );
    assert!(
        err.to_string().contains("alias.x"),
        "the rendered refusal must name the config key: {err}"
    );

    // The execution path applies the same grammar, so no process is started.
    let err = policy
        .execute(
            "git",
            &[
                "-c".to_string(),
                "alias.x=!echo escaped".to_string(),
                "x".to_string(),
            ],
            temp.path(),
        )
        .await
        .expect_err("the execution path must refuse the same argument list");
    let (rejected, reason) = refused_argument(&err);
    assert!(
        rejected.contains("alias.x") && reason.contains("alias.x"),
        "the execution path refuses the same key: {err:?}"
    );

    assert_eq!(
        policy.check_command("git -c 'alias.x=' x").ok(),
        Some("git".to_string()),
        "an empty value disables the alias instead of naming a program"
    );
}

/// The gate-evidence composition, as `gate_evidence::git_capped` builds it:
/// `-c core.fsmonitor=` is the **neutralisation** form — an empty value disables
/// the hook git would otherwise run, so it names no program and must keep
/// passing. The non-empty value is the form that names a program, and it is
/// refused.
#[cfg(test)]
#[tokio::test]
async fn the_neutralised_git_hook_form_passes_and_a_named_hook_does_not() {
    let policy = CommandPolicy::from_config(&["git".to_string()]);
    let temp = crate::test_util::fresh_tempdir();

    assert_eq!(
        policy
            .check_command("git -c core.fsmonitor= diff --no-ext-diff")
            .ok(),
        Some("git".to_string()),
        "the neutralisation form must stay allowed"
    );

    // The same argument list through the execution path resolves and spawns:
    // git runs in an empty directory and fails on the repository, not on policy.
    let output = policy
        .execute(
            "git",
            &[
                "-c".to_string(),
                "core.fsmonitor=".to_string(),
                "-C".to_string(),
                temp.path().to_string_lossy().into_owned(),
                "diff".to_string(),
                "--no-ext-diff".to_string(),
            ],
            temp.path(),
        )
        .await
        .expect("the neutralised form reaches a process");
    assert!(
        output.exit_code.is_some(),
        "git ran and reported an exit status: {output:?}"
    );

    let err = policy
        .check_command("git -c core.fsmonitor=/tmp/hook diff")
        .expect_err("a non-empty fsmonitor value names a program git runs");
    let (_, reason) = refused_argument(&err);
    assert!(
        reason.contains("core.fsmonitor"),
        "the refusal names the key it refused: {reason}"
    );
}

/// A benign config override is still an ordinary argument, and the keys that
/// name an editor, pager, filter driver, credential helper or hook are refused
/// when their value is set. `git commit -c HEAD` shows the `-c` is only read as a
/// config override when what follows is a `key=value`.
#[cfg(test)]
#[test]
fn benign_git_config_overrides_pass_and_program_naming_keys_are_refused() {
    let policy = CommandPolicy::from_config(&["git".to_string()]);

    for allowed in [
        "git -c user.name=Agent commit -m done",
        "git -c core.autocrlf=false status",
        "git commit -c HEAD",
        "git diff --no-ext-diff",
    ] {
        assert!(
            policy.check_command(allowed).is_ok(),
            "`{allowed}` names no program and must pass"
        );
    }

    for refused in [
        "git -c core.pager='less -R' log",
        "git -c core.editor=nano commit",
        "git -c editor=nano commit",
        "git -c sequence.editor=nano rebase -i HEAD~2",
        "git -c interactive.diffFilter=/tmp/filter add -p",
        "git -c core.fsmonitorHook=/tmp/hook status",
        "git -c core.hooksPath=/tmp/hooks commit",
        "git -c core.attributesfile=/tmp/attrs status",
        "git -c diff.external=/tmp/diff diff",
        "git -c 'filter.x.clean=sh -c cat' status",
        "git -c 'alias.k4probe=!echo shell-reached' k4probe",
        "git -ccore.pager=less log",
        "git --config-env=core.pager=LESS log",
        "git -c credential.helper='!evil' push",
    ] {
        let err = policy
            .check_command(refused)
            .expect_err("a config key that names a program must be refused");
        let (_, reason) = refused_argument(&err);
        assert!(
            reason.contains("config key"),
            "expected a config-key refusal for `{refused}`, got {err:?}"
        );
    }
}

/// `--exec-path` hands git a directory of its own executables, so the allow-list
/// is bypassed without even naming a config key. The grammar is git's: another
/// allow-listed program keeps its own arguments.
#[cfg(test)]
#[test]
fn a_git_exec_path_argument_is_refused() {
    let policy = CommandPolicy::from_config(&["git".to_string()]);

    for refused in [
        "git --exec-path",
        "git --exec-path=/tmp/bin status",
        "git --EXEC-PATH=/tmp/bin status",
    ] {
        let err = policy
            .check_command(refused)
            .expect_err("`--exec-path` must be refused");
        let (rejected, reason) = refused_argument(&err);
        assert!(
            rejected.eq_ignore_ascii_case("--exec-path")
                || rejected.to_ascii_lowercase().starts_with("--exec-path="),
            "the refused argument is the flag itself: {rejected}"
        );
        assert!(
            reason.contains("directory of its own executables"),
            "the reason says why the flag is refused: {reason}"
        );
    }

    assert!(
        policy.check_command("git status --porcelain").is_ok(),
        "an ordinary git invocation still passes"
    );
    assert!(
        CommandPolicy::default()
            .check_command("cargo test --exec-path")
            .is_ok(),
        "the argument grammar belongs to git, not to every program"
    );
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
    let _lock = crate::test_util::ENV_LOCK.lock().await;
    let _g1 = crate::test_util::EnvVarGuard::set("WARSHA_LLM_API_KEY", "sk-secret-llm-key-value");
    let _g2 = crate::test_util::EnvVarGuard::set("WARSHA_AUTH_TOKEN", "daemon-secret-auth-token");
    let _g3 = crate::test_util::EnvVarGuard::set("OPENAI_API_KEY", "sk-openai-daemon-secret");
    let _g4 = crate::test_util::EnvVarGuard::set("ANTHROPIC_API_KEY", "sk-anthropic-daemon-secret");
    let _g5 =
        crate::test_util::EnvVarGuard::set("WARSHA_DAEMON_SECRET_CANARY", "canary-secret-12345");

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
#[allow(clippy::panic)]
#[tokio::test]
async fn the_child_inherits_the_daemons_path_but_no_secret() {
    let _lock = crate::test_util::ENV_LOCK.lock().await;
    let _canary =
        crate::test_util::EnvVarGuard::set("WARSHA_DAEMON_SECRET_CANARY", "canary-secret-12345");
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
    let (pid, result) = policy
        .execute_with_pid_resolved(cmd, &args, temp.path())
        .await;
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
        .execute_with_pid_resolved("sh", &["-c".to_string(), script], temp.path())
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
