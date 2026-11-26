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
///
/// Deletes the worktree and also removes the run's branch (`warsha/run-<id>`)
/// best-effort so orphan run branches do not accumulate.
pub async fn remove_run_worktree(repo: &Path, worktree: &RunWorktree) -> Result<()> {
    ensure_repository(repo).await?;
    // Best-effort branch lookup BEFORE removal: resolve the attached branch from
    // `git worktree list --porcelain` so a renamed or moved directory can never
    // point the later deletion at the wrong branch. Looked up first because the
    // path disappears from the list once removal succeeds.
    let target = worktree.path.to_string_lossy().to_string();
    let target_canon = std::fs::canonicalize(&worktree.path)
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    let branch: Option<String> = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .await
        .ok()
        .and_then(|list_out| {
            if !list_out.status.success() {
                return None;
            }
            let text = String::from_utf8_lossy(&list_out.stdout).into_owned();
            let mut current_path: Option<&str> = None;
            for line in text.lines() {
                if let Some(p) = line.strip_prefix("worktree ") {
                    current_path = Some(p.trim());
                } else if let Some(b) = line.strip_prefix("branch ") {
                    let hit = current_path
                        .map(|p| {
                            p == target || target_canon.as_deref().map(|c| p == c).unwrap_or(false)
                        })
                        .unwrap_or(false);
                    if hit {
                        return b.trim().strip_prefix("refs/heads/").map(str::to_string);
                    }
                } else if line.is_empty() {
                    current_path = None;
                }
            }
            None
        });
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

    // Delete the resolved branch only if it carries the `warsha/run-` prefix;
    // never force-delete user branches (e.g. main, feature).
    if let Some(branch) = branch {
        if branch.starts_with("warsha/run-") {
            let branch_out = tokio::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(["branch", "-D", &branch])
                .output()
                .await;
            if let Ok(b_out) = branch_out {
                if !b_out.status.success() {
                    tracing::warn!(
                        branch = %branch,
                        error = %String::from_utf8_lossy(&b_out.stderr).trim(),
                        "best-effort branch deletion after worktree removal failed"
                    );
                }
            }
        } else {
            tracing::debug!(
                branch = %branch,
                "skipping branch deletion: does not match warsha/run- prefix"
            );
        }
    }

    Ok(())
}

pub use warsha_core::is_warsha_internal_path;

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

fn validate_folder_name(name: &str) -> Result<&str> {
    if name.contains('\0') {
        return Err(WorktreeError::InvalidName {
            field: "folder name",
            value: name.to_string(),
        });
    }
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.starts_with('-')
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.chars().any(char::is_control)
    {
        return Err(WorktreeError::InvalidName {
            field: "folder name",
            value: name.to_string(),
        });
    }
    Ok(trimmed)
}

async fn has_head_commit(repo: &Path) -> Result<bool> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--verify", "HEAD"])
        .output()
        .await?;
    Ok(output.status.success())
}

async fn ensure_local_git_identity(repo: &Path) -> Result<bool> {
    let name_check = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["config", "user.name"])
        .output()
        .await?;
    let email_check = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["config", "user.email"])
        .output()
        .await?;
    let has_name = name_check.status.success()
        && !String::from_utf8_lossy(&name_check.stdout)
            .trim()
            .is_empty();
    let has_email = email_check.status.success()
        && !String::from_utf8_lossy(&email_check.stdout)
            .trim()
            .is_empty();

    if !has_name {
        let out = tokio::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["config", "user.name", "Warsha"])
            .output()
            .await?;
        if !out.status.success() {
            return Err(WorktreeError::Git(format!(
                "git config user.name failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
    }
    if !has_email {
        let out = tokio::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["config", "user.email", "warsha@local"])
            .output()
            .await?;
        if !out.status.success() {
            return Err(WorktreeError::Git(format!(
                "git config user.email failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
    }
    Ok(has_name && has_email)
}

async fn ensure_initial_commit_without_clobber(repo: &Path, title: &str) -> Result<()> {
    let had_identity = ensure_local_git_identity(repo).await?;

    let gitignore_path = repo.join(".gitignore");
    if !gitignore_path.exists() {
        tokio::fs::write(&gitignore_path, "target/\nnode_modules/\n.DS_Store\n").await?;
    }

    let readme_path = repo.join("README.md");
    if !readme_path.exists() {
        let clean_title = title.trim();
        let heading = if clean_title.is_empty() {
            "Warsha Project"
        } else {
            clean_title
        };
        tokio::fs::write(&readme_path, format!("# {heading}\n")).await?;
    }

    let add_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["add", "-A"])
        .output()
        .await?;
    if !add_output.status.success() {
        return Err(WorktreeError::Git(format!(
            "git add failed: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        )));
    }

    let cached_diff = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["diff", "--cached", "--quiet"])
        .output()
        .await?;
    let has_staged = !cached_diff.status.success();

    let mut commit_cmd = tokio::process::Command::new("git");
    commit_cmd.arg("-C").arg(repo);
    if !had_identity {
        commit_cmd.args(["-c", "user.name=Warsha", "-c", "user.email=warsha@local"]);
    }
    if has_staged {
        commit_cmd.args(["commit", "-qm", "initial commit"]);
    } else {
        commit_cmd.args(["commit", "--allow-empty", "-qm", "initial commit"]);
    }
    let commit_output = commit_cmd.output().await?;
    if !commit_output.status.success() {
        return Err(WorktreeError::Git(format!(
            "git commit failed: {}",
            String::from_utf8_lossy(&commit_output.stderr).trim()
        )));
    }
    Ok(())
}

/// Prepare a folder under `parent` as an initialized git repository with a `HEAD` commit.
pub async fn prepare_new_folder(parent: &Path, name: &str) -> Result<PathBuf> {
    if !parent.is_dir() {
        return Err(WorktreeError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!(
                "parent directory `{}` does not exist or is not a directory",
                parent.display()
            ),
        )));
    }
    let folder = validate_folder_name(name)?;
    let target = parent.join(folder);
    if target.exists() && !target.is_dir() {
        return Err(WorktreeError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("`{}` exists and is not a directory", target.display()),
        )));
    }

    if target.join(".git").exists()
        && validate_repository(&target).await.is_ok()
        && has_head_commit(&target).await?
    {
        return Ok(target);
    }

    tokio::fs::create_dir_all(&target).await?;
    if !target.join(".git").exists() {
        let init_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(&target)
            .args(["init", "-q"])
            .output()
            .await?;
        if !init_output.status.success() {
            return Err(WorktreeError::Git(format!(
                "git init failed: {}",
                String::from_utf8_lossy(&init_output.stderr).trim()
            )));
        }
    }

    if !has_head_commit(&target).await? {
        ensure_initial_commit_without_clobber(&target, folder).await?;
    }

    validate_repository(&target).await?;
    Ok(target)
}

fn is_github_shorthand_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn parse_github_shorthand(source: &str) -> Option<(String, String)> {
    if source.contains("://")
        || source.starts_with('/')
        || source.starts_with('.')
        || source.starts_with('~')
    {
        return None;
    }
    let bytes = source.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return None;
    }
    let (owner, repo_raw) = source.split_once('/')?;
    if repo_raw.contains('/') {
        return None;
    }
    if !is_github_shorthand_segment(owner) || !is_github_shorthand_segment(repo_raw) {
        return None;
    }
    let repo = repo_raw.strip_suffix(".git").unwrap_or(repo_raw);
    if !is_github_shorthand_segment(repo) {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

fn strip_url_credentials(url: &str, strip_username: bool) -> Result<String> {
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| WorktreeError::InvalidName {
            field: "repository source",
            value: url.to_string(),
        })?;
    let (authority, suffix) = match rest.find(['/', '?', '#']) {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };
    if authority.is_empty() {
        return Err(WorktreeError::InvalidName {
            field: "repository source",
            value: url.to_string(),
        });
    }
    let clean_authority = match authority.rsplit_once('@') {
        Some((userinfo, host)) => {
            if host.is_empty() {
                return Err(WorktreeError::InvalidName {
                    field: "repository source",
                    value: url.to_string(),
                });
            }
            if strip_username {
                host.to_string()
            } else if let Some((user, _pass)) = userinfo.split_once(':') {
                if user.is_empty() {
                    host.to_string()
                } else {
                    format!("{user}@{host}")
                }
            } else {
                format!("{userinfo}@{host}")
            }
        }
        None => authority.to_string(),
    };
    Ok(format!("{scheme}://{clean_authority}{suffix}"))
}

enum CloneSource {
    Remote {
        clone_arg: String,
        clean_repo_url: String,
        is_https: bool,
    },
    LocalPath {
        clone_arg: String,
    },
}

fn normalize_clone_source(source: &str) -> Result<CloneSource> {
    if source.contains('\0') || source.chars().any(char::is_control) {
        return Err(WorktreeError::InvalidName {
            field: "repository source",
            value: source.to_string(),
        });
    }
    let trimmed = source.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || trimmed.to_ascii_lowercase().starts_with("ext::")
    {
        return Err(WorktreeError::InvalidName {
            field: "repository source",
            value: source.to_string(),
        });
    }

    if let Some((owner, repo)) = parse_github_shorthand(trimmed) {
        let normalized = format!("https://github.com/{owner}/{repo}.git");
        return Ok(CloneSource::Remote {
            clone_arg: normalized.clone(),
            clean_repo_url: normalized,
            is_https: true,
        });
    }

    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        if trimmed.chars().any(char::is_whitespace) {
            return Err(WorktreeError::InvalidName {
                field: "repository source",
                value: source.to_string(),
            });
        }
        let clean = strip_url_credentials(trimmed, true)?;
        let is_https = clean.starts_with("https://");
        return Ok(CloneSource::Remote {
            clone_arg: clean.clone(),
            clean_repo_url: clean,
            is_https,
        });
    }

    if trimmed.starts_with("ssh://") {
        if trimmed.chars().any(char::is_whitespace) {
            return Err(WorktreeError::InvalidName {
                field: "repository source",
                value: source.to_string(),
            });
        }
        let clean = strip_url_credentials(trimmed, false)?;
        return Ok(CloneSource::Remote {
            clone_arg: clean.clone(),
            clean_repo_url: clean,
            is_https: false,
        });
    }

    if trimmed.starts_with("git@") {
        if trimmed.chars().any(char::is_whitespace) {
            return Err(WorktreeError::InvalidName {
                field: "repository source",
                value: source.to_string(),
            });
        }
        let Some((host, path)) = trimmed.split_once(':') else {
            return Err(WorktreeError::InvalidName {
                field: "repository source",
                value: source.to_string(),
            });
        };
        if host.len() <= "git@".len() || path.trim().is_empty() {
            return Err(WorktreeError::InvalidName {
                field: "repository source",
                value: source.to_string(),
            });
        }
        return Ok(CloneSource::Remote {
            clone_arg: trimmed.to_string(),
            clean_repo_url: trimmed.to_string(),
            is_https: false,
        });
    }

    if let Some(rest) = trimmed.strip_prefix("file://") {
        if rest.trim().is_empty() {
            return Err(WorktreeError::InvalidName {
                field: "repository source",
                value: source.to_string(),
            });
        }
        return Ok(CloneSource::Remote {
            clone_arg: trimmed.to_string(),
            clean_repo_url: trimmed.to_string(),
            is_https: false,
        });
    }

    if Path::new(trimmed).is_dir() {
        return Ok(CloneSource::LocalPath {
            clone_arg: trimmed.to_string(),
        });
    }

    Err(WorktreeError::InvalidName {
        field: "repository source",
        value: source.to_string(),
    })
}

fn derive_clone_folder_name(source: &str, folder_name: Option<&str>) -> Result<String> {
    if let Some(explicit) = folder_name.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(validate_folder_name(explicit)?.to_string());
    }
    let trimmed = source.trim().trim_end_matches(['/', '\\']);
    let after_colon = if trimmed.starts_with("git@") && !trimmed.contains("://") {
        trimmed.rsplit_once(':').map_or(trimmed, |(_, rhs)| rhs)
    } else {
        trimmed
    };
    let last_segment = after_colon
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(after_colon);
    let stripped = last_segment.strip_suffix(".git").unwrap_or(last_segment);
    Ok(validate_folder_name(stripped)?.to_string())
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Clone a git repository into `dest_parent/<folder_name>` and ensure a `HEAD` commit exists.
pub async fn clone_repository(
    source: &str,
    dest_parent: &Path,
    folder_name: Option<&str>,
    github_token: Option<&str>,
) -> Result<(PathBuf, Option<String>)> {
    if !dest_parent.is_dir() {
        return Err(WorktreeError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!(
                "destination parent directory `{}` does not exist or is not a directory",
                dest_parent.display()
            ),
        )));
    }

    let parsed = normalize_clone_source(source)?;
    let (clone_arg, clean_repo_url, is_https) = match parsed {
        CloneSource::Remote {
            clone_arg,
            clean_repo_url,
            is_https,
        } => (clone_arg, Some(clean_repo_url), is_https),
        CloneSource::LocalPath { clone_arg } => (clone_arg, None, false),
    };

    let safe_folder = derive_clone_folder_name(&clone_arg, folder_name)?;
    let target = dest_parent.join(&safe_folder);
    if target.exists() {
        if !target.is_dir() {
            return Err(WorktreeError::Io(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!(
                    "`{}` already exists and is not a directory",
                    target.display()
                ),
            )));
        }
        let mut entries = tokio::fs::read_dir(&target).await?;
        if entries.next_entry().await?.is_some() {
            return Err(WorktreeError::Io(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!(
                    "target directory `{}` already exists and is not empty",
                    target.display()
                ),
            )));
        }
    }

    let mut cmd = tokio::process::Command::new("git");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    let token_clean = github_token.map(str::trim).filter(|t| !t.is_empty());
    if is_https {
        if let Some(token) = token_clean {
            let encoded = base64_encode(format!("x-access-token:{token}").as_bytes());
            cmd.args([
                "-c",
                &format!("http.extraHeader=Authorization: Basic {encoded}"),
            ]);
        }
    }
    cmd.args(["clone", "--quiet", "--", &clone_arg])
        .arg(&target);

    let output = cmd.output().await?;
    if !output.status.success() {
        let mut stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if let Some(token) = token_clean {
            stderr = stderr.replace(token, "[REDACTED]");
        }
        return Err(WorktreeError::Git(format!("git clone failed: {stderr}")));
    }

    if !target.join(".git").exists() {
        return Err(WorktreeError::NotARepository(target.display().to_string()));
    }
    validate_repository(&target).await?;

    if !has_head_commit(&target).await? {
        ensure_initial_commit_without_clobber(&target, &safe_folder).await?;
    }

    Ok((target, clean_repo_url))
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

        // Verify the warsha/run-<id> branch was also deleted
        let branches = tokio::process::Command::new("git")
            .arg("-C")
            .arg(repo.path())
            .args(["branch", "--list", "warsha/run-run9"])
            .output()
            .await
            .expect("git branch --list");
        assert!(
            String::from_utf8_lossy(&branches.stdout).trim().is_empty(),
            "branch warsha/run-run9 should be deleted by remove_run_worktree"
        );
    }

    #[tokio::test]
    async fn removal_preserves_branches_without_warsha_run_prefix() {
        let (repo, root) = temp_repo();

        // Create a non-run user branch
        let branch_status = tokio::process::Command::new("git")
            .arg("-C")
            .arg(repo.path())
            .args(["branch", "user-feature", "HEAD"])
            .status()
            .await
            .expect("create user branch");
        assert!(branch_status.success());

        // Create a worktree attached to user-feature
        let wt_path = root.path().join("user-feature-wt");
        let wt_status = tokio::process::Command::new("git")
            .arg("-C")
            .arg(repo.path())
            .args(["worktree", "add"])
            .arg(&wt_path)
            .arg("user-feature")
            .status()
            .await
            .expect("create worktree");
        assert!(wt_status.success());

        let worktree = RunWorktree {
            path: wt_path.clone(),
            base: "user-feature".to_string(),
        };

        remove_run_worktree(repo.path(), &worktree)
            .await
            .expect("worktree removal succeeds");
        assert!(!wt_path.exists());

        // Verify that user-feature branch is PRESERVED and not deleted with -D
        let branches = tokio::process::Command::new("git")
            .arg("-C")
            .arg(repo.path())
            .args(["branch", "--list", "user-feature"])
            .output()
            .await
            .expect("git branch --list");
        let list_str = String::from_utf8_lossy(&branches.stdout);
        assert!(
            list_str.contains("user-feature"),
            "user branch must be preserved by remove_run_worktree: {list_str}"
        );
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

    #[tokio::test]
    async fn prepare_new_folder_creates_repo_with_head_and_supports_worktree() {
        let parent = tempfile::tempdir().expect("parent dir");
        let repo_path = prepare_new_folder(parent.path(), "my-app")
            .await
            .expect("prepare_new_folder");
        assert_eq!(repo_path, parent.path().join("my-app"));
        assert!(repo_path.join(".git").exists());
        assert!(repo_path.join("README.md").exists());
        assert!(has_head_commit(&repo_path).await.expect("head check"));

        let wt_root = parent.path().join("worktrees");
        let wt = create_run_worktree(&repo_path, &wt_root, "run-1", "HEAD")
            .await
            .expect("create_run_worktree on prepared folder");
        assert!(wt.path.exists());
    }

    #[tokio::test]
    async fn prepare_new_folder_preserves_existing_files_and_rejects_bad_names() {
        let parent = tempfile::tempdir().expect("parent dir");
        let existing = parent.path().join("existing-app");
        std::fs::create_dir_all(&existing).expect("mkdir");
        std::fs::write(existing.join("README.md"), "# Custom\n").expect("write readme");
        std::fs::write(existing.join("notes.txt"), "keep me\n").expect("write notes");

        let prepared = prepare_new_folder(parent.path(), "existing-app")
            .await
            .expect("prepare existing dir");
        assert_eq!(
            std::fs::read_to_string(prepared.join("README.md")).expect("read readme"),
            "# Custom\n"
        );
        assert_eq!(
            std::fs::read_to_string(prepared.join("notes.txt")).expect("read notes"),
            "keep me\n"
        );
        assert!(has_head_commit(&prepared).await.expect("head exists"));

        for bad in ["", "   ", ".", "..", "-evil", "a/b", "a\\b"] {
            assert!(
                prepare_new_folder(parent.path(), bad).await.is_err(),
                "expected error for folder name `{bad}`"
            );
        }
        assert!(
            prepare_new_folder(&parent.path().join("missing-parent"), "ok")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn clone_repository_clones_local_bare_and_empty_bare_repos() {
        let tmp = tempfile::tempdir().expect("tmp");
        let seed = tmp.path().join("seed");
        std::fs::create_dir_all(&seed).expect("seed dir");
        std::fs::write(seed.join("hello.txt"), "world\n").expect("write seed");
        git_repo(&seed);

        let bare = tmp.path().join("sample-app.git");
        let out = Command::new("git")
            .args(["clone", "--bare", "--quiet"])
            .arg(&seed)
            .arg(&bare)
            .output()
            .expect("bare clone");
        assert!(out.status.success());

        let dest_parent = tmp.path().join("projects");
        std::fs::create_dir_all(&dest_parent).expect("dest parent");

        let (cloned, repo_url) =
            clone_repository(bare.to_str().expect("utf8 path"), &dest_parent, None, None)
                .await
                .expect("clone local bare repo");
        assert_eq!(cloned, dest_parent.join("sample-app"));
        assert!(repo_url.is_none());
        assert_eq!(
            std::fs::read_to_string(cloned.join("hello.txt")).expect("cloned file"),
            "world\n"
        );

        let empty_bare = tmp.path().join("empty-repo.git");
        let empty_out = Command::new("git")
            .args(["init", "--bare", "--quiet"])
            .arg(&empty_bare)
            .output()
            .expect("init empty bare");
        assert!(empty_out.status.success());

        let file_url = format!("file://{}", empty_bare.display());
        let (cloned_empty, empty_url) =
            clone_repository(&file_url, &dest_parent, Some("custom-empty"), None)
                .await
                .expect("clone empty bare repo");
        assert_eq!(cloned_empty, dest_parent.join("custom-empty"));
        assert_eq!(empty_url.as_deref(), Some(file_url.as_str()));
        assert!(has_head_commit(&cloned_empty)
            .await
            .expect("head commit created"));

        let remote = Command::new("git")
            .current_dir(&cloned_empty)
            .args(["remote", "get-url", "origin"])
            .output()
            .expect("get origin");
        assert_eq!(String::from_utf8_lossy(&remote.stdout).trim(), file_url);
    }

    #[test]
    fn normalize_clone_source_handles_shorthand_and_strips_credentials() {
        match normalize_clone_source("octocat/hello-world").expect("shorthand") {
            CloneSource::Remote {
                clone_arg,
                clean_repo_url,
                is_https,
            } => {
                assert_eq!(clone_arg, "https://github.com/octocat/hello-world.git");
                assert_eq!(clean_repo_url, "https://github.com/octocat/hello-world.git");
                assert!(is_https);
            }
            _ => panic!("expected remote"),
        }

        match normalize_clone_source("https://x-access-token:secret123@github.com/org/repo.git")
            .expect("strip https credentials")
        {
            CloneSource::Remote {
                clone_arg,
                clean_repo_url,
                is_https,
            } => {
                assert_eq!(clone_arg, "https://github.com/org/repo.git");
                assert_eq!(clean_repo_url, "https://github.com/org/repo.git");
                assert!(is_https);
            }
            _ => panic!("expected remote"),
        }

        for bad in [
            "",
            "   ",
            "-u./evil",
            "ext::sh -c id",
            "https://bad url/repo.git",
        ] {
            assert!(
                normalize_clone_source(bad).is_err(),
                "expected error for `{bad}`"
            );
        }
    }
}
