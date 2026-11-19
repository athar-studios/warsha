//! Gate C evidence (ENGINE E5 slice): the diff, changed files and test run a
//! reviewer needs to decide Gate C, plus the dev-server preview that already
//! exists for the run.
//!
//! Read-only: it never stages, commits or pushes, and it never starts a preview —
//! the preview it carries is what the caller's manager reports, or `None`. The test
//! command is executed with no shell, its output is capped in memory, and a timeout
//! kills the child. The command itself is the caller's responsibility to authorise
//! (the daemon runs its command policy before calling this); this module only
//! measures what it did.

use crate::command_policy::CommandPolicy;
use crate::process_spawn::{LivePreview, ProcessStatus};
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

/// The dev-server preview a Gate C reviewer can open, as it already stands.
///
/// This is a record, not a handle the daemon acts on: Gate C evidence never
/// starts, stops or reloads a preview. The daemon's live-preview manager is keyed
/// by project, so today this is the preview of the run's *project* — there is no
/// per-run or per-worktree preview — and it is recorded as such rather than
/// implied to be the worktree's own server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewEvidence {
    /// The project whose dev server this is (the preview manager's key).
    pub project_id: String,
    /// The managed process behind the preview.
    pub process_id: String,
    /// The URL the server printed, or `None` when it printed none.
    pub url: Option<String>,
    /// The observed process status.
    pub status: ProcessStatus,
}

impl PreviewEvidence {
    /// The preview for Gate C, or `None` when the server is not up.
    ///
    /// A terminal status (stopped, failed, crashed) is not a preview a reviewer can
    /// open, and nothing is started to fill the gap.
    pub fn live(preview: LivePreview) -> Option<Self> {
        if preview.status.is_terminal() {
            return None;
        }
        Some(PreviewEvidence {
            project_id: preview.project_id,
            process_id: preview.process_id,
            url: preview.url,
            status: preview.status,
        })
    }
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
    /// The run's preview when one is already up, else an explicit `None`.
    ///
    /// [`collect_gate_evidence`] always leaves this `None`: collecting evidence
    /// never starts, stages or commits anything for the preview. The caller
    /// attaches what its preview manager already reports, through
    /// [`GateEvidence::with_preview`].
    pub preview: Option<PreviewEvidence>,
}

impl GateEvidence {
    /// Record the preview that already exists for the run.
    ///
    /// Read-only: `preview` is what the daemon's preview manager reports without
    /// waiting for anything to start, and a server that is not up leaves
    /// [`GateEvidence::preview`] as an explicit `None` rather than an error.
    pub fn with_preview(mut self, preview: Option<LivePreview>) -> Self {
        self.preview = preview.and_then(PreviewEvidence::live);
        self
    }
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
        // Collection measures the worktree; the preview belongs to the caller, so
        // nothing is invented here (and no server is started to fill it in).
        preview: None,
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
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
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

    /// The half `a_chatty_test_is_capped` cannot see: its pipeline absorbs the
    /// signal, so it exits 0 either way. Here the command itself writes past the
    /// cap, so a reader that closes the pipe kills it with `SIGPIPE` — and the
    /// pass would be recorded as a failure.
    #[cfg(unix)]
    #[tokio::test]
    async fn an_over_cap_passing_test_is_recorded_as_passing_and_truncated() {
        let repo = temp_repo();
        // 204 800 bytes is past both the 64 KiB cap and a pipe buffer; `dd`
        // (unlike coreutils `head`) reports the broken pipe as a failure.
        let (program, args) = sh("dd if=/dev/zero bs=8192 count=25 2>/dev/null");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));

        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("an over-cap test must not fail evidence collection");

        assert_eq!(
            evidence.tests.exit_code,
            Some(0),
            "the test command was killed instead of drained to its own exit"
        );
        assert!(
            evidence.tests.success,
            "a passing test that printed over the cap was recorded as failed"
        );
        assert!(evidence.tests.truncated);
        assert!(evidence.tests.stdout.ends_with(TRUNCATION_MARKER));
        assert!(
            evidence.tests.stdout.len() <= GATE_EVIDENCE_CAPTURE_BYTES + TRUNCATION_MARKER.len()
        );
    }

    /// The same defect on the `git_capped` path, where it is louder: a non-zero
    /// git status is a hard error, so a diff over the cap used to fail the whole
    /// evidence call. A large diff must arrive truncated instead.
    #[cfg(unix)]
    #[tokio::test]
    async fn an_over_cap_diff_is_collected_truncated_not_failed() {
        let repo = temp_repo();
        // Far past both the cap and a pipe buffer, so git is still writing when
        // a reader that closes at the cap takes its pipe away (a diff only a
        // little over the cap can finish inside the freed pipe buffer and hide
        // the defect).
        let big = "x".repeat(GATE_EVIDENCE_CAPTURE_BYTES * 64);
        std::fs::write(repo.path().join("base.txt"), &big).expect("the file changes");
        let (program, args) = sh("true");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));

        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("an over-cap diff must not fail evidence collection");

        assert!(
            evidence.diff.contains("diff --git a/base.txt b/base.txt"),
            "the real diff must still be collected:\n{}",
            &evidence.diff[..evidence.diff.len().min(200)]
        );
        assert!(
            evidence.diff.ends_with(TRUNCATION_MARKER),
            "an over-cap diff should be marked truncated"
        );
        assert!(evidence.diff.len() <= GATE_EVIDENCE_CAPTURE_BYTES + TRUNCATION_MARKER.len());
        assert!(evidence.tests.success);
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

        assert!(evidence.tests.success);
        assert!(!evidence.tests.stdout.is_empty());
        assert!(evidence.tests.stdout.contains("PATH="));
        assert!(evidence.tests.stdout.contains("TERM=dumb"));
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

    /// The vectors measured in the CP2 review: a repository the agent can write
    /// names the program `git diff`/`git status` execute (`diff.external`,
    /// `core.fsmonitor`). Evidence collection must not run them — and must still
    /// report the real diff, so a neutralisation that silently collected nothing
    /// would not pass.
    #[cfg(unix)]
    #[tokio::test]
    async fn repo_config_hooks_do_not_run_during_evidence_collection() {
        use std::os::unix::fs::PermissionsExt;

        let repo = temp_repo();
        let marker = repo.path().join("hook.ran");
        let hook = repo.path().join("hook.sh");
        std::fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\n", marker.display()))
            .expect("the hook is written");
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755))
            .expect("the hook is executable");
        let hook_path = hook.to_str().expect("the hook path is unicode");

        for (key, value) in [("diff.external", hook_path), ("core.fsmonitor", hook_path)] {
            let status = Command::new("git")
                .current_dir(repo.path())
                .args(["config", key, value])
                .status()
                .expect("git config runs");
            assert!(status.success(), "git config {key} failed");
        }
        std::fs::write(repo.path().join("base.txt"), "changed").expect("the file changes");

        let (program, args) = sh("true");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));
        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");

        assert!(
            !marker.exists(),
            "a repository-configured hook ran while collecting evidence"
        );
        assert!(
            evidence.diff.contains("-base") && evidence.diff.contains("+changed"),
            "the diff itself must still be collected:\n{}",
            evidence.diff
        );
        assert!(evidence.files_changed.iter().any(|path| path == "base.txt"));

        // Control: in the same repository a plain `git diff` does run the
        // configured program, so the assertion above is not vacuous.
        // `core.fsmonitor` is disabled for the control because its trigger needs
        // index-extension state and is not deterministic in every environment;
        // `diff.external` is, and it is the same repository-config-named-program
        // vector.
        let status = Command::new("git")
            .current_dir(repo.path())
            .args(["-c", "core.fsmonitor=", "diff", "HEAD"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("the control git diff runs");
        assert!(status.success(), "the control git diff failed");
        assert!(
            marker.exists(),
            "the control `git diff` did not run the configured hook: this test can no longer prove the vector is live"
        );
    }

    /// A preview as the manager reports it, without starting one.
    fn preview(status: ProcessStatus, url: Option<&str>) -> LivePreview {
        LivePreview {
            project_id: "project-1".to_string(),
            process_id: "proc-1".to_string(),
            command: "npm".to_string(),
            args: vec!["run".to_string(), "dev".to_string()],
            status,
            url: url.map(str::to_string),
        }
    }

    /// The preview is the caller's to report: collection leaves it unset, and only
    /// a server that is still up is carried.
    #[cfg(unix)]
    #[tokio::test]
    async fn only_a_live_preview_is_carried_as_evidence() {
        let repo = temp_repo();
        let (program, args) = sh("true");
        let policy = CommandPolicy::from_config(std::slice::from_ref(&program));
        let evidence = collect_gate_evidence(&policy, repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");
        assert!(
            evidence.preview.is_none(),
            "collecting evidence invented a preview"
        );

        let carried = evidence
            .clone()
            .with_preview(Some(preview(
                ProcessStatus::Running,
                Some("http://127.0.0.1:5173/"),
            )))
            .preview
            .expect("a running preview is carried");
        assert_eq!(carried.project_id, "project-1");
        assert_eq!(carried.process_id, "proc-1");
        assert_eq!(carried.url.as_deref(), Some("http://127.0.0.1:5173/"));
        assert_eq!(carried.status, ProcessStatus::Running);

        // A server whose process is gone is not a preview a reviewer can open.
        for status in [
            ProcessStatus::Stopped,
            ProcessStatus::Failed,
            ProcessStatus::Crashed,
        ] {
            assert!(
                evidence
                    .clone()
                    .with_preview(Some(preview(status, Some("http://127.0.0.1:5173/"))))
                    .preview
                    .is_none(),
                "{status:?} was carried as a live preview"
            );
        }
        assert!(evidence.with_preview(None).preview.is_none());
    }

    /// "No preview" has to reach the reviewer as a `null` they can see, not as a
    /// field that quietly disappears from the response.
    #[test]
    fn an_absent_preview_serialises_as_an_explicit_null() {
        let evidence = GateEvidence {
            diff: String::new(),
            files_changed: Vec::new(),
            tests: TestRun {
                program: "true".to_string(),
                args: Vec::new(),
                success: true,
                exit_code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: 0,
                truncated: false,
            },
            preview: None,
        };

        let value = serde_json::to_value(&evidence).expect("the evidence serialises");
        assert_eq!(
            value.get("preview"),
            Some(&serde_json::Value::Null),
            "an absent preview must be an explicit null, not an omitted field"
        );
    }
}
