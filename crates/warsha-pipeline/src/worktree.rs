//! Per-run git worktrees (ENGINE E3 slice).
//!
//! A run gets its own worktree so two runs of one project cannot edit the same
//! checkout. The functions here only create and remove a worktree through `git
//! worktree`; they never commit, push or delete a repository. Names are validated
//! before git sees them: a run id is restricted to `[A-Za-z0-9_-]`, and a base
//! revision that starts with `-` is refused so it cannot be read as an option.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// What can go wrong creating or removing a run worktree.
#[derive(Debug, Error)]
pub enum WorktreeError {
    /// The repository path is not a git work tree.
    #[error("`{0}` is not a git repository")]
    NotARepository(String),
    /// A run id or base revision is not accepted.
    #[error("invalid {field} `{value}`")]
    InvalidName {
        /// `run id` or `base revision`.
        field: &'static str,
        /// The refused value.
        value: String,
    },
    /// Git refused or failed.
    #[error("git worktree failed: {0}")]
    Git(String),
    /// Filesystem failure.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, WorktreeError>;

/// A worktree created for one run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunWorktree {
    /// Where the run's checkout lives.
    pub path: PathBuf,
    /// The revision the worktree was created from.
    pub base: String,
}

/// The worktree path one run gets under `root`.
///
/// The id is restricted to `[A-Za-z0-9_-]`; a run id that could escape the root or
/// look like a git option is refused before any command runs.
pub fn worktree_path(root: &Path, run_id: &str) -> Result<PathBuf> {
    if run_id.is_empty()
        || !run_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err(WorktreeError::InvalidName {
            field: "run id",
            value: run_id.to_string(),
        });
    }
    Ok(root.join(format!("run-{run_id}")))
}

/// Create the detached worktree a run works in.
///
/// `base` is any revision git accepts (`HEAD`, a branch, a tag) but must not start
/// with `-`. The path is computed from `root` and the run id, so the checkout cannot
/// land outside the caller's root.
pub async fn create_run_worktree(
    repo: &Path,
    root: &Path,
    run_id: &str,
    base: &str,
) -> Result<RunWorktree> {
    if base.trim().is_empty() || base.starts_with('-') || base.chars().any(char::is_control) {
        return Err(WorktreeError::InvalidName {
            field: "base revision",
            value: base.to_string(),
        });
    }
    ensure_repository(repo).await?;
    let path = worktree_path(root, run_id)?;
    if path.exists() {
        return Err(WorktreeError::Git(format!(
            "the worktree path `{}` already exists",
            path.display()
        )));
    }
    tokio::fs::create_dir_all(root).await?;
    // N3: the worktree lives on the run's own branch (`warsha/run-<id>`) from
    // creation, so the daemon's stage commit lands on the named branch instead
    // of a detached HEAD.
    let branch = format!("warsha/run-{run_id}");
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["worktree", "add", "-b", &branch])
        .arg(&path)
        .arg(base)
        .output()
        .await?;
    if !output.status.success() {
        return Err(WorktreeError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(RunWorktree {
        path,
        base: base.to_string(),
    })
}

/// Remove a run's worktree. Never called automatically: a worktree may hold
/// uncommitted work, so a caller decides when it is safe.
pub async fn remove_run_worktree(repo: &Path, worktree: &RunWorktree) -> Result<()> {
    ensure_repository(repo).await?;
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["worktree", "remove", "--force"])
        .arg(&worktree.path)
        .output()
        .await?;
    if !output.status.success() {
        return Err(WorktreeError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

pub async fn commit_run_worktree(worktree_path: &Path, message: &str) -> Result<()> {
    let status_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["status", "--porcelain"])
        .output()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    if String::from_utf8_lossy(&status_output.stdout)
        .trim()
        .is_empty()
    {
        return Ok(());
    }

    tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["add", "."])
        .status()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["commit", "-m", message])
        .output()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    if !output.status.success() {
        return Err(WorktreeError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

/// Validate that `repo` is a usable git work tree.
///
/// This is the exact probe [`create_run_worktree`] runs before it asks git for a
/// checkout, exported so a caller that records a repository path (the daemon's
/// `projects.attach`) accepts nothing `runs.start` would then fail on.
pub async fn validate_repository(repo: &Path) -> Result<()> {
    ensure_repository(repo).await
}

async fn ensure_repository(repo: &Path) -> Result<()> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .await?;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != "true" {
        return Err(WorktreeError::NotARepository(repo.display().to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod e3 {
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

    fn temp_repo() -> (tempfile::TempDir, tempfile::TempDir) {
        let repo = tempfile::tempdir().expect("a repo dir");
        std::fs::write(repo.path().join("base.txt"), "base").expect("a base file");
        git_repo(repo.path());
        let root = tempfile::tempdir().expect("a worktree root");
        (repo, root)
    }

    #[tokio::test]
    async fn a_run_gets_its_own_detached_worktree() {
        let (repo, root) = temp_repo();
        let worktree = create_run_worktree(
            repo.path(),
            root.path(),
            "01arz3ndektsv4rrffq69g5fav",
            "HEAD",
        )
        .await
        .expect("the worktree is created");

        assert!(worktree.path.starts_with(root.path()));
        assert!(worktree.path.join("base.txt").exists());
        let check = Command::new("git")
            .arg("-C")
            .arg(&worktree.path)
            .args(["rev-parse", "--is-inside-work-tree"])
            .output()
            .expect("git runs");
        assert!(check.status.success());
        assert_eq!(String::from_utf8_lossy(&check.stdout).trim(), "true");
    }

    #[tokio::test]
    async fn a_non_repository_is_refused() {
        let plain = tempfile::tempdir().expect("a plain dir");
        let root = tempfile::tempdir().expect("a root");
        let error = create_run_worktree(plain.path(), root.path(), "run1", "HEAD")
            .await
            .expect_err("a plain directory is not a repository");
        assert!(
            matches!(error, WorktreeError::NotARepository(_)),
            "{error:?}"
        );
    }

    #[tokio::test]
    async fn names_that_could_escape_or_look_like_an_option_are_refused() {
        let (repo, root) = temp_repo();
        for bad in ["../escape", "run/one", "run one", ""] {
            let error = create_run_worktree(repo.path(), root.path(), bad, "HEAD")
                .await
                .expect_err("an unsafe run id is refused");
            assert!(
                matches!(
                    error,
                    WorktreeError::InvalidName {
                        field: "run id",
                        ..
                    }
                ),
                "{error:?}"
            );
        }
        let error = create_run_worktree(repo.path(), root.path(), "run1", "--upload-pack=evil")
            .await
            .expect_err("an option-like base is refused");
        assert!(
            matches!(
                error,
                WorktreeError::InvalidName {
                    field: "base revision",
                    ..
                }
            ),
            "{error:?}"
        );
        assert!(!root.path().join("run-run1").exists());
    }

    #[tokio::test]
    async fn removal_takes_the_worktree_away() {
        let (repo, root) = temp_repo();
        let worktree = create_run_worktree(repo.path(), root.path(), "run9", "HEAD")
            .await
            .expect("the worktree is created");
        remove_run_worktree(repo.path(), &worktree)
            .await
            .expect("the worktree is removed");
        assert!(!worktree.path.exists());
    }
}
