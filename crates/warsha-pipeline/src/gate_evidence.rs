//! Gate C evidence (ENGINE E5 slice): the diff, changed files and test run a
//! reviewer needs to decide Gate C.
//!
//! Read-only: it never stages, commits or pushes. The test command is executed
//! with no shell, its output is capped in memory, and a timeout kills the child.
//! The command itself is the caller's responsibility to authorise (the daemon runs
//! its command policy before calling this); this module only measures what it did.

use crate::command_policy::CommandPolicy;
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The most bytes kept combined from stdout and stderr.
pub const GATE_EVIDENCE_CAPTURE_BYTES: usize = 64 * 1024;
/// The wall-clock bound a Gate C test command gets.
pub const GATE_EVIDENCE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Appended to output that hit the capture cap.
pub const TRUNCATION_MARKER: &str = "\n…[truncated]";

/// What can go wrong collecting Gate C evidence.
#[derive(Debug, Error)]
pub enum GateEvidenceError {
    /// A name or argument is not accepted.
    #[error("invalid {field} `{value}`")]
    Invalid {
        /// The refused field.
        field: &'static str,
        /// The refused value.
        value: String,
    },
    /// Filesystem or process failure.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    /// The test command did not finish in time.
    #[error("the test command did not finish within {0:?}")]
    Timeout(Duration),
}

pub type Result<T> = std::result::Result<T, GateEvidenceError>;

/// One test command's measured result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TestRun {
    /// The program that ran.
    pub program: String,
    /// Its arguments.
    pub args: Vec<String>,
    /// Whether it exited 0.
    pub success: bool,
    /// The exit code, when the platform reports one.
    pub exit_code: Option<i32>,
    /// Captured stdout, capped.
    pub stdout: String,
    /// Captured stderr, capped.
    pub stderr: String,
    /// How long it ran.
    pub duration_ms: u64,
    /// Whether either stream hit the capture cap.
    pub truncated: bool,
}

/// Everything a Gate C reviewer looks at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GateEvidence {
    /// The diff against the base revision, capped.
    pub diff: String,
    /// The paths git reports as changed.
    pub files_changed: Vec<String>,
    /// The measured test run.
    pub tests: TestRun,
}

/// Collect the diff, changed paths and test result for a Gate C decision.
pub async fn collect_gate_evidence(
    policy: &CommandPolicy,
    work_dir: &Path,
    base: &str,
    test_program: &str,
    test_args: &[String],
) -> Result<GateEvidence> {
    collect_gate_evidence_with_timeout(
        policy,
        work_dir,
        base,
        test_program,
        test_args,
        GATE_EVIDENCE_TIMEOUT,
    )
    .await
}

/// The same collection with an explicit test deadline (the test seam).
pub(crate) async fn collect_gate_evidence_with_timeout(
    policy: &CommandPolicy,
    work_dir: &Path,
    base: &str,
    test_program: &str,
    test_args: &[String],
    timeout: Duration,
) -> Result<GateEvidence> {
    if base.trim().is_empty() || base.starts_with('-') || base.chars().any(char::is_control) {
        return Err(GateEvidenceError::Invalid {
            field: "base revision",
            value: base.to_string(),
        });
    }
    if test_program.trim().is_empty() || test_program.chars().any(char::is_control) {
        return Err(GateEvidenceError::Invalid {
            field: "test program",
            value: test_program.to_string(),
        });
    }
    if test_args
        .iter()
        .any(|arg| arg.chars().any(char::is_control))
    {
        return Err(GateEvidenceError::Invalid {
            field: "test argument",
            value: test_args.join(" "),
        });
    }

    let (diff, _) = git_capped(work_dir, &["diff", base]).await?;
    let (status, _) = git_capped(work_dir, &["status", "--porcelain"]).await?;
    let files_changed = status
        .lines()
        .filter_map(|line| line.get(3..).map(str::trim))
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect();
    let tests = run_tests(policy, work_dir, test_program, test_args, timeout).await?;
    // Evidence is shown to a reviewer and may be logged or exported: a credential
    // a test or a diff prints must not travel with it. This is the same shape-based
    // pass the daemon's logs use; it is an extra layer, not a promise that a
    // non-credential-shaped secret is caught.
    Ok(GateEvidence {
        diff: crate::guardrails::mask_secrets(&diff),
        files_changed,
        tests: TestRun {
            stdout: crate::guardrails::mask_secrets(&tests.stdout),
            stderr: crate::guardrails::mask_secrets(&tests.stderr),
            ..tests
        },
    })
}

async fn git_capped(work_dir: &Path, args: &[&str]) -> Result<(String, bool)> {
    // Daemon-authored infrastructure, not an agent command: its own allow-list
    // that always admits `git`, so a narrowed owner policy cannot break Gate C.
    // `-c core.fsmonitor=` and `diff --no-ext-diff` neutralise the repository
    // configuration the agent can write, which would otherwise name the program
    // git runs. Global options must precede the subcommand; subcommand options
    // must follow it.
    let policy = CommandPolicy::from_config(&["git".to_string()])
        .with_timeout(GATE_EVIDENCE_TIMEOUT)
        .with_output_cap(GATE_EVIDENCE_CAPTURE_BYTES);
    let Some((subcommand, rest)) = args.split_first() else {
        return Err(GateEvidenceError::Invalid {
            field: "git arguments",
            value: String::new(),
        });
    };
    let work_dir_arg = work_dir.to_str().ok_or_else(|| {
        std::io::Error::other(format!("non-unicode work dir {}", work_dir.display()))
    })?;
    let mut argv: Vec<String> = vec![
        "-c".to_string(),
        "core.fsmonitor=".to_string(),
        "-C".to_string(),
        work_dir_arg.to_string(),
        (*subcommand).to_string(),
    ];
    if *subcommand == "diff" {
        argv.push("--no-ext-diff".to_string());
    }
    argv.extend(rest.iter().map(|arg| (*arg).to_string()));

    let output = policy
        .execute("git", &argv, work_dir)
        .await
        .map_err(|e| GateEvidenceError::Io(std::io::Error::other(e.to_string())))?;
    if !output.success {
        return Err(GateEvidenceError::Io(std::io::Error::other(format!(
            "git {} failed in {}",
            args.join(" "),
            work_dir.display()
        ))));
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.truncated {
        text.push_str(TRUNCATION_MARKER);
    }
    Ok((text, output.truncated))
}

async fn run_tests(
    policy: &CommandPolicy,
    work_dir: &Path,
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<TestRun> {
    let started = Instant::now();
    let policy = policy
        .clone()
        .with_timeout(timeout)
        .with_output_cap(GATE_EVIDENCE_CAPTURE_BYTES);
    match policy.execute(program, args, work_dir).await {
        Ok(output) => {
            let mut stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let mut stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            if output.truncated {
                if output.stdout.len() >= GATE_EVIDENCE_CAPTURE_BYTES {
                    stdout.push_str(TRUNCATION_MARKER);
                }
                if output.stderr.len() >= GATE_EVIDENCE_CAPTURE_BYTES
                    || (output.stdout.len() + output.stderr.len() >= GATE_EVIDENCE_CAPTURE_BYTES
                        && !output.stderr.is_empty())
                {
                    stderr.push_str(TRUNCATION_MARKER);
                }
                if !stdout.ends_with(TRUNCATION_MARKER) && !stderr.ends_with(TRUNCATION_MARKER) {
                    if !stdout.is_empty() {
                        stdout.push_str(TRUNCATION_MARKER);
                    } else {
                        stderr.push_str(TRUNCATION_MARKER);
                    }
                }
            }
            Ok(TestRun {
                program: program.to_string(),
                args: args.to_vec(),
                success: output.success,
                exit_code: output.exit_code,
                stdout,
                stderr,
                duration_ms: started.elapsed().as_millis() as u64,
                truncated: output.truncated,
            })
        }
        Err(crate::command_policy::CommandPolicyError::TimedOut { .. }) => {
            Err(GateEvidenceError::Timeout(timeout))
        }
        Err(e) => Err(GateEvidenceError::Io(std::io::Error::other(e.to_string()))),
    }
}

#[cfg(test)]
mod e5 {
    use super::*;
    use std::process::{Command, Stdio};

    fn git_repo(dir: &Path) {
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

    fn temp_repo() -> tempfile::TempDir {
        let repo = tempfile::tempdir().expect("a repo dir");
        std::fs::write(repo.path().join("base.txt"), "base").expect("a base file");
        git_repo(repo.path());
        repo
    }

    #[cfg(unix)]
    fn sh(script: &str) -> (String, Vec<String>) {
        ("sh".to_string(), vec!["-c".to_string(), script.to_string()])
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn evidence_carries_the_diff_files_and_a_passing_test() {
        let repo = temp_repo();
        std::fs::write(repo.path().join("base.txt"), "changed").expect("the file changes");
        std::fs::write(repo.path().join("made.txt"), "made").expect("a file is created");
        let (program, args) = sh("echo ok");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));

        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");

        assert!(evidence.diff.contains("base.txt"), "{}", evidence.diff);
        assert!(evidence.files_changed.iter().any(|p| p == "base.txt"));
        assert!(evidence.files_changed.iter().any(|p| p == "made.txt"));
        assert!(evidence.tests.success);
        assert!(evidence.tests.stdout.contains("ok"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_failing_test_is_recorded_not_hidden() {
        let repo = temp_repo();
        let (program, args) = sh("echo boom >&2; exit 2");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));

        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");

        assert!(!evidence.tests.success);
        assert_eq!(evidence.tests.exit_code, Some(2));
        assert!(evidence.tests.stderr.contains("boom"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_chatty_test_is_capped() {
        let repo = temp_repo();
        let (program, args) = sh("yes output | head -c 200000");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));
        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");

        assert!(evidence.tests.truncated);
        assert!(
            evidence.tests.stdout.len() <= GATE_EVIDENCE_CAPTURE_BYTES + TRUNCATION_MARKER.len()
        );
        assert!(evidence.tests.stdout.ends_with(TRUNCATION_MARKER));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_hanging_test_times_out() {
        let repo = temp_repo();
        let (program, args) = sh("sleep 5");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));
        let error = collect_gate_evidence_with_timeout(
            &policy,
            repo.path(),
            "HEAD",
            &program,
            &args,
            Duration::from_millis(100),
        )
        .await
        .expect_err("a hanging test times out");
        assert!(matches!(error, GateEvidenceError::Timeout(_)), "{error:?}");
    }

    #[tokio::test]
    async fn option_like_names_are_refused() {
        let repo = temp_repo();
        let policy = CommandPolicy::default();
        let error = collect_gate_evidence(&policy, repo.path(), "--evil", "true", &[])
            .await
            .expect_err("an option-like base is refused");
        assert!(
            matches!(
                error,
                GateEvidenceError::Invalid {
                    field: "base revision",
                    ..
                }
            ),
            "{error:?}"
        );
        let error = collect_gate_evidence(&policy, repo.path(), "HEAD", " ", &[])
            .await
            .expect_err("an empty program is refused");
        assert!(
            matches!(
                error,
                GateEvidenceError::Invalid {
                    field: "test program",
                    ..
                }
            ),
            "{error:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_credential_shaped_secret_in_the_test_output_is_redacted() {
        let repo = temp_repo();
        let (program, args) = sh("echo sk-live-abcdef0123456789");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));
        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");
        assert!(!evidence.tests.stdout.contains("sk-live-abcdef0123456789"));
        assert!(evidence.tests.stdout.contains(crate::guardrails::REDACTED));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_credential_shaped_secret_in_the_diff_is_redacted() {
        let repo = temp_repo();
        std::fs::write(
            repo.path().join("base.txt"),
            "token sk-live-abcdef0123456789",
        )
        .expect("the file changes");
        let (program, args) = sh("true");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));
        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");
        assert!(!evidence.diff.contains("sk-live-abcdef0123456789"));
        assert!(evidence.diff.contains(crate::guardrails::REDACTED));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_evidence_child_sees_none_of_the_daemons_variables() {
        struct EnvGuard(&'static str);
        impl Drop for EnvGuard {
            fn drop(&mut self) {
                std::env::remove_var(self.0);
            }
        }

        let repo = temp_repo();
        std::env::set_var("WARSHA_LLM_API_KEY", "sk-secret-llm-key-value");
        let _g1 = EnvGuard("WARSHA_LLM_API_KEY");
        std::env::set_var("WARSHA_AUTH_TOKEN", "daemon-secret-auth-token");
        let _g2 = EnvGuard("WARSHA_AUTH_TOKEN");
        std::env::set_var("OPENAI_API_KEY", "sk-openai-daemon-secret");
        let _g3 = EnvGuard("OPENAI_API_KEY");
        std::env::set_var("WARSHA_DAEMON_SECRET_CANARY", "canary-secret-12345");
        let _g4 = EnvGuard("WARSHA_DAEMON_SECRET_CANARY");

        let (program, args) = sh("env");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));
        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");

        for secret in [
            "WARSHA_LLM_API_KEY",
            "sk-secret-llm-key-value",
            "WARSHA_AUTH_TOKEN",
            "daemon-secret-auth-token",
            "OPENAI_API_KEY",
            "sk-openai-daemon-secret",
            "WARSHA_DAEMON_SECRET_CANARY",
            "canary-secret-12345",
        ] {
            assert!(
                !evidence.tests.stdout.contains(secret),
                "daemon variable `{secret}` leaked into evidence test output:\n{}",
                evidence.tests.stdout
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_child_that_spawns_a_grandchild_and_hangs_is_group_killed_at_timeout() {
        let repo = temp_repo();
        let pid_file = repo.path().join("grandchild.pid");
        let script = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());
        let (program, args) = sh(&script);
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));

        let error = collect_gate_evidence_with_timeout(
            &policy,
            repo.path(),
            "HEAD",
            &program,
            &args,
            Duration::from_millis(500),
        )
        .await
        .expect_err("the hanging test must time out");

        assert!(matches!(error, GateEvidenceError::Timeout(_)));

        let grandchild = std::fs::read_to_string(&pid_file)
            .expect("the shell records its background child's pid")
            .trim()
            .parse::<u32>()
            .expect("the pid file holds a valid u32 pid");

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut gone = false;
        while std::time::Instant::now() < deadline {
            let alive = tokio::process::Command::new("kill")
                .args(["-0", &grandchild.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map(|s| s.success())
                .unwrap_or(false);
            if !alive {
                gone = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(
            gone,
            "grandchild process {grandchild} survived the timeout: process group was not killed"
        );
    }
}
