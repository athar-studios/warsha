//! Work protection — snapshots, undo, worktree isolation, read-before-write and
//! per-session permission modes (PLAN.md M14a, LingCode-inspired ideas only).
//!
//! This module is the policy and bookkeeping layer, not a git wrapper. A
//! snapshot is a run-scoped set of file contents; [`SnapshotStore`] is the
//! persistence seam, and the in-memory implementation here is both the mock for
//! tests and the default for a run. A future git-backed store (stash/commit
//! checkpoint) implements the same trait, so nothing above it changes.
//!
//! What lives here:
//!
//! - [`PermissionMode`] / [`WorkProtectionPolicy`] — what an agent may do
//!   without asking the owner.
//! - [`Snapshot`] / [`SnapshotFile`] / [`SnapshotStore`] — restore points taken
//!   before an agent edit, and the contents to put back.
//! - [`ReadBeforeWriteGuard`] — an agent may not overwrite a file it has not
//!   read in the current run.
//! - [`UndoStack`] — a bounded, per-run undo history for AI operations; it is
//!   cleared on approve, and the run's event store is the durable copy.
//!
//! Per-hunk keep/revert is deliberately absent: the run view reuses the
//! existing diff viewer for that, and no second diff engine is introduced.

use std::collections::{HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// How many [`UndoEntry`] values one [`UndoStack`] keeps.
///
/// The stack is scoped to a run and lives in memory, so the cap bounds the
/// memory an agentic editing session can occupy; the oldest entry falls off
/// first.
pub const MAX_UNDO_ENTRIES: usize = 50;

/// How much an agent may do before the owner is asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    /// Ask before every agent edit, even inside the project.
    AskAlways,
    /// Ask only for risky operations: writes outside the project, network
    /// access and spend.
    #[default]
    AskForRisky,
    /// Never ask while the agent stays inside the project directory.
    AutoInsideProject,
}

/// The work-protection settings of one project or session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WorkProtectionPolicy {
    /// When the owner is asked before an agent edit.
    pub mode: PermissionMode,
    /// Take a [`Snapshot`] before an agent edits files.
    pub snapshot_before_edit: bool,
    /// Run risky tasks in an isolated `git worktree`, merged only at Gate C.
    pub worktree_isolation: bool,
    /// Refuse to overwrite a file the agent has not read in this run.
    pub read_before_write: bool,
}

impl Default for WorkProtectionPolicy {
    /// The shipped default: ask for risky work, snapshot before edits, no
    /// worktree isolation unless the owner turns it on, and read-before-write
    /// enforced.
    fn default() -> Self {
        Self {
            mode: PermissionMode::AskForRisky,
            snapshot_before_edit: true,
            worktree_isolation: false,
            read_before_write: true,
        }
    }
}

/// One file's contents inside a [`Snapshot`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotFile {
    /// Path relative to the project root.
    pub path: String,
    /// Full file contents at snapshot time (not a diff).
    pub content: String,
}

/// A restore point taken before an agent edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    /// Stable identifier used by [`SnapshotStore::restore`].
    pub id: String,
    /// The run the snapshot belongs to; a run only ever restores its own.
    pub run_id: String,
    /// Creation time, seconds since the Unix epoch.
    pub created_at: u64,
    /// The files covered by this snapshot.
    pub files: Vec<SnapshotFile>,
}

impl Snapshot {
    /// The path of every file in the snapshot, in snapshot order.
    pub fn paths(&self) -> Vec<&str> {
        self.files.iter().map(|file| file.path.as_str()).collect()
    }
}

/// Errors raised by the work-protection layer.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum WorkProtectionError {
    /// A snapshot with that id is already stored.
    #[error("snapshot `{0}` already exists")]
    DuplicateSnapshot(String),
    /// No snapshot with that id is stored.
    #[error("snapshot `{0}` not found")]
    SnapshotNotFound(String),
    /// The snapshot cannot be stored as given.
    #[error("invalid snapshot: {0}")]
    InvalidSnapshot(String),
}

/// Where snapshots live.
///
/// The in-memory implementation here is the default for a run and the mock for
/// tests; a git-backed store (stash or checkpoint commit) implements the same
/// three methods.
pub trait SnapshotStore {
    /// Store a snapshot, rejecting a duplicate id.
    fn create(&mut self, snapshot: Snapshot) -> Result<(), WorkProtectionError>;

    /// Put the snapshot's file contents back, returning what was restored.
    fn restore(&self, id: &str) -> Result<Snapshot, WorkProtectionError>;

    /// Every snapshot of one run, oldest first.
    fn list(&self, run_id: &str) -> Vec<Snapshot>;
}

/// A [`SnapshotStore`] that keeps snapshots in memory, in creation order.
#[derive(Debug, Default)]
pub struct InMemorySnapshotStore {
    snapshots: Vec<Snapshot>,
}

impl InMemorySnapshotStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// How many snapshots are stored across all runs.
    pub fn len(&self) -> usize {
        self.snapshots.len()
    }

    /// Whether the store holds no snapshots.
    pub fn is_empty(&self) -> bool {
        self.snapshots.is_empty()
    }
}

impl SnapshotStore for InMemorySnapshotStore {
    fn create(&mut self, snapshot: Snapshot) -> Result<(), WorkProtectionError> {
        if snapshot.id.trim().is_empty() {
            return Err(WorkProtectionError::InvalidSnapshot(
                "snapshot id must not be empty".to_string(),
            ));
        }
        if self.snapshots.iter().any(|stored| stored.id == snapshot.id) {
            return Err(WorkProtectionError::DuplicateSnapshot(snapshot.id));
        }
        self.snapshots.push(snapshot);
        Ok(())
    }

    fn restore(&self, id: &str) -> Result<Snapshot, WorkProtectionError> {
        self.snapshots
            .iter()
            .find(|stored| stored.id == id)
            .cloned()
            .ok_or_else(|| WorkProtectionError::SnapshotNotFound(id.to_string()))
    }

    fn list(&self, run_id: &str) -> Vec<Snapshot> {
        self.snapshots
            .iter()
            .filter(|stored| stored.run_id == run_id)
            .cloned()
            .collect()
    }
}

/// Refuses a write to a file the agent has not read in the current run.
///
/// The tool layer asks [`ReadBeforeWriteGuard::may_write`] before every
/// overwrite and calls [`ReadBeforeWriteGuard::record_read`] whenever a file is
/// read. When the policy has `read_before_write: false` the guard allows
/// everything, so the check can stay in the tool layer unconditionally.
#[derive(Debug, Clone)]
pub struct ReadBeforeWriteGuard {
    required: bool,
    read_paths: HashSet<String>,
}

impl ReadBeforeWriteGuard {
    /// A guard that enforces the rule only when `read_before_write` is set.
    pub fn new(read_before_write: bool) -> Self {
        Self {
            required: read_before_write,
            read_paths: HashSet::new(),
        }
    }

    /// A guard configured from a [`WorkProtectionPolicy`].
    pub fn from_policy(policy: &WorkProtectionPolicy) -> Self {
        Self::new(policy.read_before_write)
    }

    /// Record that the agent read `path` in this run.
    pub fn record_read(&mut self, path: &str) {
        self.read_paths.insert(normalize_path(path).to_string());
    }

    /// Whether the agent may overwrite `path`.
    ///
    /// True when the rule is disabled or the file was read in this run.
    pub fn may_write(&self, path: &str) -> bool {
        !self.required || self.has_read(path)
    }

    /// Whether `path` was read in this run.
    pub fn has_read(&self, path: &str) -> bool {
        self.read_paths.contains(normalize_path(path))
    }

    /// Forget every recorded read, e.g. when a new run starts.
    pub fn clear(&mut self) {
        self.read_paths.clear();
    }
}

/// One entry in the undo history: which snapshot to restore, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UndoEntry {
    /// The snapshot this entry restores.
    pub snapshot_id: String,
    /// Plain-language description shown on the undo card.
    pub description: String,
}

impl UndoEntry {
    /// Build an entry from a snapshot id and a description.
    pub fn new(snapshot_id: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            snapshot_id: snapshot_id.into(),
            description: description.into(),
        }
    }
}

/// A bounded, in-memory undo history for AI operations in one run.
///
/// Last in, first out: [`UndoStack::pop`] returns the most recent entry. The
/// stack is cleared when the run is approved. The event store keeps the durable
/// copy, so a crash costs the in-memory history, not the snapshots themselves.
#[derive(Debug)]
pub struct UndoStack {
    entries: VecDeque<UndoEntry>,
    limit: usize,
}

impl UndoStack {
    /// An empty stack with the default cap of [`MAX_UNDO_ENTRIES`].
    pub fn new() -> Self {
        Self::with_limit(MAX_UNDO_ENTRIES)
    }

    /// An empty stack with an explicit cap; the oldest entry falls off first.
    pub fn with_limit(limit: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            limit,
        }
    }

    /// Push an entry, dropping the oldest one when the cap is reached.
    ///
    /// A stack with a cap of `0` keeps nothing.
    pub fn push(&mut self, entry: UndoEntry) {
        if self.limit == 0 {
            return;
        }
        while self.entries.len() >= self.limit {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    /// Pop the most recent entry.
    pub fn pop(&mut self) -> Option<UndoEntry> {
        self.entries.pop_back()
    }

    /// Drop the whole history, e.g. on approve.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// How many entries the stack holds.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the stack holds no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// How many entries the stack keeps at most.
    pub fn limit(&self) -> usize {
        self.limit
    }
}

impl Default for UndoStack {
    fn default() -> Self {
        Self::new()
    }
}

/// Snapshot paths arrive both as `src/main.rs` and as `./src/main.rs`, so both
/// forms must match the same guard entry.
fn normalize_path(path: &str) -> &str {
    let trimmed = path.trim();
    trimmed.strip_prefix("./").unwrap_or(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(id: &str, run_id: &str, files: &[(&str, &str)]) -> Snapshot {
        Snapshot {
            id: id.to_string(),
            run_id: run_id.to_string(),
            created_at: 1_700_000_000,
            files: files
                .iter()
                .map(|(path, content)| SnapshotFile {
                    path: (*path).to_string(),
                    content: (*content).to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn default_policy_matches_the_shipped_settings() {
        let policy = WorkProtectionPolicy::default();
        assert_eq!(policy.mode, PermissionMode::AskForRisky);
        assert!(policy.snapshot_before_edit);
        assert!(!policy.worktree_isolation);
        assert!(policy.read_before_write);
    }

    #[test]
    fn snapshot_create_and_restore_roundtrip() {
        let mut store = InMemorySnapshotStore::new();
        let before = snapshot(
            "snap-1",
            "run-1",
            &[
                ("src/main.rs", "fn main() {}\n"),
                ("README.md", "# Warsha\n"),
            ],
        );
        store.create(before.clone()).expect("create snapshot");

        let restored = store.restore("snap-1").expect("restore snapshot");
        assert_eq!(restored, before);
        assert_eq!(restored.paths(), vec!["src/main.rs", "README.md"]);
        assert_eq!(restored.files[0].content, "fn main() {}\n");
        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());
    }

    #[test]
    fn snapshot_list_is_scoped_to_one_run_and_ordered() {
        let mut store = InMemorySnapshotStore::new();
        store
            .create(snapshot("snap-1", "run-1", &[("a.rs", "1")]))
            .expect("create snap-1");
        store
            .create(snapshot("snap-2", "run-2", &[("b.rs", "2")]))
            .expect("create snap-2");
        store
            .create(snapshot("snap-3", "run-1", &[("c.rs", "3")]))
            .expect("create snap-3");

        let run_one: Vec<String> = store
            .list("run-1")
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(run_one, vec!["snap-1", "snap-3"]);
        assert_eq!(store.list("run-9").len(), 0);
    }

    #[test]
    fn snapshot_store_rejects_duplicate_and_unknown_ids() {
        let mut store = InMemorySnapshotStore::new();
        store
            .create(snapshot("snap-1", "run-1", &[("a.rs", "1")]))
            .expect("create snap-1");

        let duplicate = store.create(snapshot("snap-1", "run-1", &[("a.rs", "2")]));
        assert_eq!(
            duplicate,
            Err(WorkProtectionError::DuplicateSnapshot("snap-1".to_string()))
        );

        let missing = store.restore("snap-404");
        assert_eq!(
            missing,
            Err(WorkProtectionError::SnapshotNotFound(
                "snap-404".to_string()
            ))
        );

        let empty = store.create(snapshot("  ", "run-1", &[]));
        assert!(matches!(
            empty,
            Err(WorkProtectionError::InvalidSnapshot(_))
        ));
    }

    #[test]
    fn read_before_write_blocks_unread_files() {
        let mut guard = ReadBeforeWriteGuard::new(true);
        assert!(!guard.may_write("src/lib.rs"));
        assert!(!guard.has_read("src/lib.rs"));

        guard.record_read("src/lib.rs");
        assert!(guard.may_write("src/lib.rs"));
        // The `./` form of the same path counts as read.
        assert!(guard.may_write("./src/lib.rs"));
        assert!(!guard.may_write("src/other.rs"));

        guard.clear();
        assert!(!guard.may_write("src/lib.rs"));
    }

    #[test]
    fn read_before_write_disabled_allows_every_write() {
        let policy = WorkProtectionPolicy {
            read_before_write: false,
            ..WorkProtectionPolicy::default()
        };
        let guard = ReadBeforeWriteGuard::from_policy(&policy);
        assert!(guard.may_write("anything/at/all.rs"));
    }

    #[test]
    fn undo_stack_is_lifo_and_capped() {
        let mut stack = UndoStack::new();
        assert!(stack.is_empty());
        assert_eq!(stack.limit(), MAX_UNDO_ENTRIES);

        for index in 0..MAX_UNDO_ENTRIES + 5 {
            stack.push(UndoEntry::new(
                format!("snap-{index}"),
                format!("edit {index}"),
            ));
        }
        assert_eq!(stack.len(), MAX_UNDO_ENTRIES);

        // The five oldest entries were dropped, the newest is on top.
        let newest = stack.pop().expect("stack is not empty");
        assert_eq!(newest.snapshot_id, format!("snap-{}", MAX_UNDO_ENTRIES + 4));
        let next = stack.pop().expect("stack has a second entry");
        assert_eq!(next.snapshot_id, format!("snap-{}", MAX_UNDO_ENTRIES + 3));
        assert_eq!(stack.len(), MAX_UNDO_ENTRIES - 2);

        let oldest_kept = stack.entries.front().expect("entries remain");
        assert_eq!(oldest_kept.snapshot_id, "snap-5");

        stack.clear();
        assert!(stack.is_empty());
        assert_eq!(stack.pop(), None);
    }

    #[test]
    fn undo_stack_honours_an_explicit_limit() {
        let mut stack = UndoStack::with_limit(2);
        stack.push(UndoEntry::new("snap-1", "first"));
        stack.push(UndoEntry::new("snap-2", "second"));
        stack.push(UndoEntry::new("snap-3", "third"));
        assert_eq!(stack.len(), 2);
        assert_eq!(
            stack.pop().map(|entry| entry.snapshot_id),
            Some("snap-3".to_string())
        );

        let mut disabled = UndoStack::with_limit(0);
        disabled.push(UndoEntry::new("snap-1", "ignored"));
        assert!(disabled.is_empty());
    }

    #[test]
    fn permission_mode_and_policy_serde_roundtrip() {
        assert_eq!(
            serde_json::to_string(&PermissionMode::AskAlways).expect("serialize mode"),
            "\"ask_always\""
        );
        assert_eq!(
            serde_json::from_str::<PermissionMode>("\"ask_for_risky\"").expect("deserialize mode"),
            PermissionMode::AskForRisky
        );
        assert_eq!(
            serde_json::from_str::<PermissionMode>("\"auto_inside_project\"")
                .expect("deserialize mode"),
            PermissionMode::AutoInsideProject
        );
        assert_eq!(PermissionMode::default(), PermissionMode::AskForRisky);

        let policy = WorkProtectionPolicy {
            mode: PermissionMode::AutoInsideProject,
            snapshot_before_edit: false,
            worktree_isolation: true,
            read_before_write: false,
        };
        let encoded = serde_json::to_string(&policy).expect("serialize policy");
        assert!(encoded.contains("\"worktree_isolation\":true"));
        let decoded: WorkProtectionPolicy =
            serde_json::from_str(&encoded).expect("deserialize policy");
        assert_eq!(decoded, policy);
    }

    #[test]
    fn undo_entry_serde_roundtrip() {
        let entry = UndoEntry::new("snap-1", "revert the coder's edit to main.rs");
        let encoded = serde_json::to_string(&entry).expect("serialize entry");
        let decoded: UndoEntry = serde_json::from_str(&encoded).expect("deserialize entry");
        assert_eq!(decoded, entry);
    }
}
