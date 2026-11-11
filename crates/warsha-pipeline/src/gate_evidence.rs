//! Gate C evidence (ENGINE E5 slice): the diff, changed files and test run a
//! reviewer needs to decide Gate C.
//!
//! Read-only: it never stages, commits or pushes. The test command is executed
//! with no shell, its output is capped in memory, and a timeout kills the child.
//! The command itself is the caller's responsibility to authorise (the daemon runs
//! its command policy before calling this); this module only measures what it did.

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt};

/// The most bytes kept from each of stdout and stderr.
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
    work_dir: &Path,
    base: &str,
    test_program: &str,
    test_args: &[String],
) -> Result<GateEvidence> {
    collect_gate_evidence_with_timeout(
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
    let tests = run_tests(work_dir, test_program, test_args, timeout).await?;
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
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(work_dir)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await?;
    if !output.status.success() {
        return Err(GateEvidenceError::Io(std::io::Error::other(format!(
            "git {} failed in {}",
            args.join(" "),
            work_dir.display()
        ))));
    }
    Ok(cap_string(output.stdout))
}

async fn run_tests(
    work_dir: &Path,
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<TestRun> {
    let started = Instant::now();
    let mut child = tokio::process::Command::new(program)
        .args(args)
        .current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| {
        GateEvidenceError::Io(std::io::Error::other("the test command has no stdout pipe"))
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        GateEvidenceError::Io(std::io::Error::other("the test command has no stderr pipe"))
    })?;

    let wait = async {
        let (out, out_truncated) = read_capped(stdout).await;
        let (err, err_truncated) = read_capped(stderr).await;
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((out, out_truncated, err, err_truncated, status))
    };
    match tokio::time::timeout(timeout, wait).await {
        Ok(Ok((out, out_truncated, err, err_truncated, status))) => Ok(TestRun {
            program: program.to_string(),
            args: args.to_vec(),
            success: status.success(),
            exit_code: status.code(),
            stdout: out,
            stderr: err,
            duration_ms: started.elapsed().as_millis() as u64,
            truncated: out_truncated || err_truncated,
        }),
        Ok(Err(error)) => Err(GateEvidenceError::Io(error)),
        Err(_) => Err(GateEvidenceError::Timeout(timeout)),
    }
}

async fn read_capped<R: AsyncRead + Unpin>(reader: R) -> (String, bool) {
    let mut limited = reader.take(GATE_EVIDENCE_CAPTURE_BYTES as u64);
    let mut buffer = Vec::new();
    let _ = limited.read_to_end(&mut buffer).await;
    let truncated = limited.limit() == 0;
    let mut text = String::from_utf8_lossy(&buffer).into_owned();
    if truncated {
        text.push_str(TRUNCATION_MARKER);
    }
    (text, truncated)
}

fn cap_string(bytes: Vec<u8>) -> (String, bool) {
    if bytes.len() > GATE_EVIDENCE_CAPTURE_BYTES {
        // Slice at the cap and let the lossy conversion handle a split UTF-8 tail:
        // `String::truncate` would panic on a multi-byte boundary (Arabic diffs).
        let mut text = String::from_utf8_lossy(&bytes[..GATE_EVIDENCE_CAPTURE_BYTES]).into_owned();
        text.push_str(TRUNCATION_MARKER);
        (text, true)
    } else {
        (String::from_utf8_lossy(&bytes).into_owned(), false)
    }
}

#[cfg(test)]
mod e5 {
    use super::*;
    use std::process::Command;

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

        let evidence = collect_gate_evidence(repo.path(), "HEAD", &program, &args)
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

        let evidence = collect_gate_evidence(repo.path(), "HEAD", &program, &args)
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
        let evidence = collect_gate_evidence(repo.path(), "HEAD", &program, &args)
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
        let error = collect_gate_evidence_with_timeout(
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
        let error = collect_gate_evidence(repo.path(), "--evil", "true", &[])
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
        let error = collect_gate_evidence(repo.path(), "HEAD", " ", &[])
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
        let evidence = collect_gate_evidence(repo.path(), "HEAD", &program, &args)
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
        let evidence = collect_gate_evidence(repo.path(), "HEAD", &program, &args)
            .await
            .expect("the evidence is collected");
        assert!(!evidence.diff.contains("sk-live-abcdef0123456789"));
        assert!(evidence.diff.contains(crate::guardrails::REDACTED));
    }
}
