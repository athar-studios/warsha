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
    #[error("git failed: {0}")]
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

/// Match paths that belong to internal `.warsha` directories or `.warsha` files
/// at the root of the worktree, without matching valid project files that share
/// a prefix like `.warsha-config.json` or nested directories like `docs/.warsha/notes.md`.
pub fn is_warsha_internal_path(path: &str) -> bool {
    let clean = path.trim().trim_matches('"');
    for c in std::path::Path::new(clean).components() {
        match c {
            std::path::Component::CurDir => continue,
            std::path::Component::Normal(name) => return name == ".warsha",
            _ => return false,
        }
    }
    false
}

pub async fn commit_run_worktree(worktree_path: &Path, message: &str) -> Result<()> {
    let status_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["status", "--porcelain"])
        .output()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    let stdout_str = String::from_utf8_lossy(&status_output.stdout);
    let meaningful_changes: Vec<&str> = stdout_str
        .lines()
        .filter(|l| {
            let path = l.get(3..).unwrap_or("").trim().trim_matches('"');
            !is_warsha_internal_path(path)
        })
        .collect();

    if meaningful_changes.is_empty() {
        return Ok(());
    }

    tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["add", "."])
        .status()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    // D-R13-CONTAIN-1: Enforce containment at STAGING as well as reporting.
    // 1. Explicitly unstage .warsha directory and files via git reset.
    let _ = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["reset", "-q", "HEAD", "--", ".warsha"])
        .status()
        .await;

    // 2. Scan staged index to unstage any remaining internal path (e.g. subdirectories).
    if let Ok(cached_output) = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["diff", "--cached", "--name-only"])
        .output()
        .await
    {
        if cached_output.status.success() {
            let cached_str = String::from_utf8_lossy(&cached_output.stdout);
            for p in cached_str.lines() {
                let p = p.trim().trim_matches('"');
                if is_warsha_internal_path(p) {
                    let _ = tokio::process::Command::new("git")
                        .arg("-C")
                        .arg(worktree_path)
                        .args(["reset", "-q", "HEAD", "--", p])
                        .status()
                        .await;
                }
            }
        }
    }

    // 3. If nothing remains staged after containment, do not create an empty commit.
    let staged_check = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["diff", "--cached", "--quiet"])
        .status()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    if staged_check.success() {
        return Ok(());
    }

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

/// The worktree's tree hash, or `None` when the path is not a git repository.
///
/// `git write-tree` hashes the index's current content — the same value before
/// and after a stage means the tree did not move. This is the read-only
/// backstop's probe (B2): it never mutates the tree.
pub async fn tree_hash(worktree_path: &Path) -> Result<Option<String>> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["write-tree"])
        .output()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    if !output.status.success() {
        // Not a repository (or an index git refuses to hash): the backstop
        // treats both as "no hash to compare" and reports the git error in the
        // violation when one is found.
        return Err(WorktreeError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(Some(
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

/// The worktree's dirty state as a sorted list of `git status --porcelain`
/// lines — the read-only backstop's probe (B2).
///
/// `git write-tree` hashes the index, which never sees untracked files; a
/// stage that writes new files would compare equal and slip past the
/// tree-hash probe. The porcelain status sees every untracked write, so the
/// backstop compares this list before and after the stage instead.
pub async fn dirty_set(worktree_path: &Path) -> Result<Vec<String>> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["status", "--porcelain"])
        .output()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;
    if !output.status.success() {
        return Err(WorktreeError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    let mut lines: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| {
            let path = l.get(3..).unwrap_or("").trim().trim_matches('"');
            !is_warsha_internal_path(path)
        })
        .map(|l| l.to_string())
        .collect();
    lines.sort();
    Ok(lines)
}

/// Restore `worktree_path` from its base revision and report what changed.
///
/// The read-only backstop's undo half (B2): a stage that moved a tree it was
/// confined not to move loses its changes and fails. `git checkout -- .`
/// resets tracked files to HEAD; untracked files are removed by hand, so the
/// restore is exact for what a CLI stage can leave behind. Returns the list
/// of paths that were restored.
pub async fn restore_run_worktree(worktree_path: &Path) -> Result<Vec<String>> {
    let status_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["status", "--porcelain"])
        .output()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    let dirty: Vec<String> = String::from_utf8_lossy(&status_output.stdout)
        .lines()
        .filter_map(|line| line.get(3..))
        .map(str::to_string)
        .collect();
    if dirty.is_empty() {
        return Ok(Vec::new());
    }

    tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["checkout", "--", "."])
        .output()
        .await
        .map_err(|e| WorktreeError::Git(e.to_string()))?;

    // Untracked files never appear in HEAD; remove exactly the dirty ones.
    // A porcelain line is `XY path` (3 chars before the path) — a file that
    // still exists after `checkout -- .` was untracked, not tracked, so it is
    // removed by hand.
    let untracked: Vec<String> = dirty
        .iter()
        .filter(|path| worktree_path.join(path.as_str()).exists())
        .cloned()
        .collect();
    for path in &untracked {
        std::fs::remove_file(worktree_path.join(path)).map_err(WorktreeError::Io)?;
    }
    Ok(dirty)
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

/// Auto-initialize a bare-minimum Git repository at `repo`.
///
/// Creates parent directories, runs `git init -q`, writes a minimal `.gitignore`
/// and `README.md`, and creates an initial commit so that [`create_run_worktree`]
/// (which requires a valid HEAD reference) can succeed immediately.
pub async fn init_repository(repo: &Path) -> Result<()> {
    init_repository_with_meta(repo, None, None).await
}

/// Auto-initialize a bare-minimum Git repository at `repo` with optional name and description.
pub async fn init_repository_with_meta(
    repo: &Path,
    name: Option<&str>,
    description: Option<&str>,
) -> Result<()> {
    tokio::fs::create_dir_all(repo).await?;

    let init_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["init", "-q"])
        .output()
        .await?;

    if !init_output.status.success() {
        let err = String::from_utf8_lossy(&init_output.stderr)
            .trim()
            .to_string();
        return Err(WorktreeError::Git(format!("git init failed: {err}")));
    }

    let gitignore_path = repo.join(".gitignore");
    tokio::fs::write(&gitignore_path, "target/\nnode_modules/\n.DS_Store\n").await?;

    let readme_path = repo.join("README.md");
    let title = name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("Warsha Project");
    let readme_content = match description.map(str::trim).filter(|d| !d.is_empty()) {
        Some(desc) => format!("# {title}\n\n{desc}\n"),
        None => format!("# {title}\n"),
    };
    tokio::fs::write(&readme_path, readme_content).await?;

    let name_check = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["config", "user.name"])
        .output()
        .await?;

    let has_user_identity = name_check.status.success()
        && !String::from_utf8_lossy(&name_check.stdout)
            .trim()
            .is_empty();

    if !has_user_identity {
        let _ = tokio::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["config", "user.name", "Warsha"])
            .output()
            .await;
        let _ = tokio::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["config", "user.email", "warsha@local"])
            .output()
            .await;
    }

    let add_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["add", ".gitignore", "README.md"])
        .output()
        .await?;

    if !add_output.status.success() {
        let err = String::from_utf8_lossy(&add_output.stderr)
            .trim()
            .to_string();
        return Err(WorktreeError::Git(format!("git add failed: {err}")));
    }

    let mut commit_cmd = tokio::process::Command::new("git");
    commit_cmd.arg("-C").arg(repo);
    if !has_user_identity {
        commit_cmd.args(["-c", "user.name=Warsha", "-c", "user.email=warsha@local"]);
    }
    commit_cmd.args(["commit", "-qm", "initial commit"]);
    let commit_output = commit_cmd.output().await?;

    if !commit_output.status.success() {
        let err = String::from_utf8_lossy(&commit_output.stderr)
            .trim()
            .to_string();
        return Err(WorktreeError::Git(format!("git commit failed: {err}")));
    }

    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
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

    #[tokio::test]
    async fn init_repository_creates_usable_repo_with_exact_files_and_head() {
        let repo_dir = tempfile::tempdir().expect("temp repo dir");
        let repo_path = repo_dir.path().join("project-repo");
        let root = tempfile::tempdir().expect("worktree root");

        init_repository_with_meta(
            &repo_path,
            Some("Test Project"),
            Some("Description for test"),
        )
        .await
        .expect("init_repository succeeds");

        validate_repository(&repo_path)
            .await
            .expect("validate_repository passes on auto-initted repo");

        let gitignore = repo_path.join(".gitignore");
        assert!(gitignore.exists(), ".gitignore must exist");
        let gitignore_content = std::fs::read_to_string(&gitignore).expect("read .gitignore");
        assert!(gitignore_content.contains("target/"));
        assert!(gitignore_content.contains("node_modules/"));

        let readme = repo_path.join("README.md");
        assert!(readme.exists(), "README.md must exist");
        let readme_content = std::fs::read_to_string(&readme).expect("read README.md");
        assert_eq!(readme_content, "# Test Project\n\nDescription for test\n");

        // Verify no extra files exist in the worktree
        let mut entries: Vec<String> = std::fs::read_dir(&repo_path)
            .expect("read_dir")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name != ".git")
            .collect();
        entries.sort();
        assert_eq!(
            entries,
            vec![".gitignore", "README.md"],
            "only .gitignore and README.md must exist in the root"
        );

        // Verify git worktree creation against HEAD succeeds
        let worktree = create_run_worktree(&repo_path, root.path(), "run-init", "HEAD")
            .await
            .expect("create_run_worktree must succeed on freshly initialized repo");
        assert!(worktree.path.join(".gitignore").exists());
        assert!(worktree.path.join("README.md").exists());
    }

    #[tokio::test]
    async fn init_repository_fail_closed_on_unwritable_path() {
        let temp = tempfile::tempdir().expect("temp dir");
        let file_path = temp.path().join("blocked-file");
        std::fs::write(&file_path, "not a directory").expect("write file");

        // Attempting to initialize inside a regular file must fail closed with Io error
        let invalid_path = file_path.join("repo");
        let err = init_repository(&invalid_path)
            .await
            .expect_err("init_repository must fail on unwritable path");
        assert!(
            matches!(err, WorktreeError::Io(_)),
            "expected Io error, got {err:?}"
        );
    }

    #[tokio::test]
    async fn already_tracked_warsha_cli_log_is_not_committed_while_legit_file_is() {
        let repo = tempfile::tempdir().expect("repo dir");
        let repo_path = repo.path();
        std::fs::write(repo_path.join("base.txt"), "base").expect("base file");
        git_repo(repo_path);

        // Pre-track .warsha/cli.log in git HEAD
        let warsha_dir = repo_path.join(".warsha");
        std::fs::create_dir_all(&warsha_dir).expect("create .warsha");
        std::fs::write(warsha_dir.join("cli.log"), "initial tracked log\n").expect("write log");
        Command::new("git")
            .current_dir(repo_path)
            .args(["add", ".warsha/cli.log"])
            .status()
            .expect("git add tracked log");
        Command::new("git")
            .current_dir(repo_path)
            .args(["commit", "-qm", "track cli.log"])
            .status()
            .expect("git commit tracked log");

        // Now simulate a run: modify .warsha/cli.log and create a legit file
        std::fs::write(warsha_dir.join("cli.log"), "new run log leaked\n").expect("append log");
        std::fs::write(repo_path.join("legit.txt"), "legitimate content\n").expect("write legit");

        commit_run_worktree(repo_path, "run commit")
            .await
            .expect("commit succeeds");

        // Check git diff of the new commit:
        let diff = Command::new("git")
            .current_dir(repo_path)
            .args(["diff", "HEAD~1", "HEAD", "--name-only"])
            .output()
            .expect("git diff");
        let diff_str = String::from_utf8_lossy(&diff.stdout);
        let changed_files: Vec<&str> = diff_str.lines().map(str::trim).collect();

        assert!(
            changed_files.contains(&"legit.txt"),
            "legit file must be committed, got: {diff_str}"
        );
        assert!(
            !changed_files.contains(&".warsha/cli.log"),
            "already-tracked .warsha/cli.log must NOT be committed in new commit, got: {diff_str}"
        );

        let head_log = Command::new("git")
            .current_dir(repo_path)
            .args(["show", "HEAD:.warsha/cli.log"])
            .output()
            .expect("git show");
        let head_log_str = String::from_utf8_lossy(&head_log.stdout);
        assert_eq!(
            head_log_str.trim(),
            "initial tracked log",
            "HEAD commit must not contain leaked run log"
        );
    }

    #[tokio::test]
    async fn unwritable_git_exclude_still_contains_warsha_log_from_commit() {
        let repo = tempfile::tempdir().expect("repo dir");
        let repo_path = repo.path();
        std::fs::write(repo_path.join("base.txt"), "base").expect("base file");
        git_repo(repo_path);

        // Make .git/info/exclude unwritable (mode 0444)
        let exclude_path = repo_path.join(".git/info/exclude");
        if let Some(p) = exclude_path.parent() {
            std::fs::create_dir_all(p).expect("create .git/info");
        }
        std::fs::write(&exclude_path, "# unwritable exclude\n").expect("write exclude");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exclude_path, std::fs::Permissions::from_mode(0o444))
                .expect("set read-only exclude");
        }

        // Simulate CLI creating .warsha/cli.log and a legitimate change
        let warsha_dir = repo_path.join(".warsha");
        std::fs::create_dir_all(&warsha_dir).expect("create .warsha");
        std::fs::write(warsha_dir.join("cli.log"), "secret cli log\n").expect("write log");
        std::fs::write(repo_path.join("feature.txt"), "feature code\n").expect("write feature");

        commit_run_worktree(repo_path, "commit feature")
            .await
            .expect("commit succeeds");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&exclude_path, std::fs::Permissions::from_mode(0o644));
        }

        let diff = Command::new("git")
            .current_dir(repo_path)
            .args(["diff", "HEAD~1", "HEAD", "--name-only"])
            .output()
            .expect("git diff");
        let diff_str = String::from_utf8_lossy(&diff.stdout);
        let changed_files: Vec<&str> = diff_str.lines().map(str::trim).collect();

        assert!(
            changed_files.contains(&"feature.txt"),
            "feature.txt must be committed, got: {diff_str}"
        );
        assert!(
            !changed_files.contains(&".warsha/cli.log"),
            ".warsha/cli.log must NOT be committed even with unwritable exclude, got: {diff_str}"
        );

        let tree = Command::new("git")
            .current_dir(repo_path)
            .args(["ls-tree", "-r", "--name-only", "HEAD"])
            .output()
            .expect("git ls-tree");
        let tree_str = String::from_utf8_lossy(&tree.stdout);
        assert!(
            !tree_str.contains(".warsha"),
            "HEAD commit tree must not contain .warsha: {tree_str}"
        );
    }

    #[tokio::test]
    async fn warsha_config_json_is_committed_and_tracked_in_dirty_set() {
        let repo = tempfile::tempdir().expect("repo dir");
        let repo_path = repo.path();
        std::fs::write(repo_path.join("base.txt"), "base").expect("base file");
        git_repo(repo_path);

        // Write .warsha-config.json only
        std::fs::write(repo_path.join(".warsha-config.json"), "{\"version\": 1}\n")
            .expect("write config");

        // dirty_set must track .warsha-config.json
        let dirty = dirty_set(repo_path).await.expect("dirty_set succeeds");
        assert!(
            dirty.iter().any(|d| d.contains(".warsha-config.json")),
            "dirty_set must include .warsha-config.json, got: {dirty:?}"
        );

        // commit_run_worktree must NOT skip committing when only .warsha-config.json changed
        commit_run_worktree(repo_path, "commit warsha config")
            .await
            .expect("commit succeeds");

        let diff = Command::new("git")
            .current_dir(repo_path)
            .args(["diff", "HEAD~1", "HEAD", "--name-only"])
            .output()
            .expect("git diff");
        let diff_str = String::from_utf8_lossy(&diff.stdout);
        assert!(
            diff_str.contains(".warsha-config.json"),
            ".warsha-config.json must be committed in HEAD, got: {diff_str}"
        );
    }

    #[tokio::test]
    async fn nested_docs_warsha_notes_is_committed_and_tracked_in_dirty_set() {
        let repo = tempfile::tempdir().expect("repo dir");
        let repo_path = repo.path();
        std::fs::write(repo_path.join("base.txt"), "base").expect("base file");
        let docs_dir = repo_path.join("docs");
        std::fs::create_dir_all(&docs_dir).expect("create docs");
        std::fs::write(docs_dir.join("guide.md"), "# Guide\n").expect("write guide");
        git_repo(repo_path);

        // Create nested docs/.warsha/notes.md and root .warsha/cli.log
        let docs_warsha = docs_dir.join(".warsha");
        std::fs::create_dir_all(&docs_warsha).expect("create docs/.warsha");
        std::fs::write(docs_warsha.join("notes.md"), "# Notes\n").expect("write notes");

        let root_warsha = repo_path.join(".warsha");
        std::fs::create_dir_all(&root_warsha).expect("create root .warsha");
        std::fs::write(root_warsha.join("cli.log"), "internal log\n").expect("write cli.log");

        // dirty_set must include docs/.warsha/ and exclude root .warsha/
        let dirty = dirty_set(repo_path).await.expect("dirty_set succeeds");
        assert!(
            dirty.iter().any(|d| d.contains("docs/.warsha")),
            "dirty_set must include docs/.warsha, got: {dirty:?}"
        );
        assert!(
            !dirty
                .iter()
                .any(|d| d.contains(".warsha/cli.log") || d.trim() == "?? .warsha/"),
            "dirty_set must not include root .warsha, got: {dirty:?}"
        );

        // commit_run_worktree must commit docs/.warsha/notes.md and exclude root .warsha/cli.log
        commit_run_worktree(repo_path, "commit nested docs warsha")
            .await
            .expect("commit succeeds");

        let diff = Command::new("git")
            .current_dir(repo_path)
            .args(["diff", "HEAD~1", "HEAD", "--name-only"])
            .output()
            .expect("git diff");
        let diff_str = String::from_utf8_lossy(&diff.stdout);
        assert!(
            diff_str.contains("docs/.warsha/notes.md"),
            "docs/.warsha/notes.md must be committed in HEAD, got: {diff_str}"
        );
        assert!(
            !diff_str.contains(".warsha/cli.log"),
            "root .warsha/cli.log must NOT be committed in HEAD, got: {diff_str}"
        );

        let tree = Command::new("git")
            .current_dir(repo_path)
            .args(["ls-tree", "-r", "--name-only", "HEAD"])
            .output()
            .expect("git ls-tree");
        let tree_str = String::from_utf8_lossy(&tree.stdout);
        assert!(
            tree_str.contains("docs/.warsha/notes.md"),
            "HEAD commit tree must contain docs/.warsha/notes.md: {tree_str}"
        );
        assert!(
            !tree_str.contains(".warsha/cli.log"),
            "HEAD commit tree must not contain .warsha/cli.log: {tree_str}"
        );

        // Now modify docs/.warsha/notes.md - dirty_set must track exact file
        std::fs::write(docs_warsha.join("notes.md"), "# Notes edited\n").expect("edit notes");
        let dirty_after_edit = dirty_set(repo_path).await.expect("dirty_set succeeds");
        assert!(
            dirty_after_edit
                .iter()
                .any(|d| d.contains("docs/.warsha/notes.md")),
            "dirty_set after edit must include docs/.warsha/notes.md, got: {dirty_after_edit:?}"
        );
    }

    #[test]
    fn test_is_warsha_internal_path_root_only() {
        assert!(is_warsha_internal_path(".warsha"));
        assert!(is_warsha_internal_path(".warsha/cli.log"));
        assert!(is_warsha_internal_path("./.warsha/cli.log"));
        assert!(is_warsha_internal_path("\".warsha/cli.log\""));
        assert!(!is_warsha_internal_path(".warsha-config.json"));
        assert!(!is_warsha_internal_path("docs/.warsha/notes.md"));
        assert!(!is_warsha_internal_path("./docs/.warsha/notes.md"));
        assert!(!is_warsha_internal_path("sub/.warsha"));
        assert!(!is_warsha_internal_path(""));
    }
}
