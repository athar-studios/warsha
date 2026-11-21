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
use warsha_core::{ApprovalMode, Confinement, ProjectPermissions};

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
    /// Bypasses permission checks entirely.
    FullAccess,
    /// Read-only confinement: the agent may read and run safe reads, but no
    /// write and no command lands anywhere (B2).
    ReadOnly,
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

/// Classification of operations based on their risk level.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RiskClass {
    Safe,
    Risky,
}

use crate::risky_commands::RISKY_COMMANDS;

/// Whether an argument is a pure `--key=value` global flag that cannot load code or execute programs.
fn is_safe_pure_flag(lowered: &str) -> bool {
    if !lowered.starts_with("--") {
        return false;
    }
    let Some((key, val)) = lowered.split_once('=') else {
        return false;
    };
    if key.len() <= 2 || val.is_empty() {
        return false;
    }
    let key_name = &key[2..];
    if key_name.contains("exec")
        || key_name.contains("script")
        || key_name.contains("config")
        || key_name.contains("file")
        || key_name.contains("load")
        || key_name.contains("require")
        || key_name.contains("import")
        || key_name.contains("eval")
        || key_name.contains("run")
        || key_name.contains("plugin")
        || key_name.contains("hook")
        || key_name.contains("path")
        || key_name.contains("env")
        || key_name.contains("tool")
        || key_name.contains("cmd")
        || key_name.contains("entry")
    {
        return false;
    }
    true
}

/// Classifies a command as safe or risky.
pub fn classify_command(program: &str, args: &[String]) -> RiskClass {
    // R6-H2: workspace-relative executables (e.g. `./npm`, `./bin/tool`, `sub/tool`)
    // must never match safe commands by basename — treat as Risky.
    if crate::command_policy::is_workspace_relative_path(program) {
        return RiskClass::Risky;
    }

    let program_name = crate::command_policy::program_name(program);

    // Shell commands are blanket-Risky.
    if crate::command_policy::is_shell_command(&program_name) {
        return RiskClass::Risky;
    }

    for risky in RISKY_COMMANDS {
        if risky.program.eq_ignore_ascii_case(&program_name) {
            if risky.argument_pattern == "*" && !risky.check_arguments_only {
                return RiskClass::Risky;
            }
            if args.iter().any(|arg| {
                let clean_arg = arg.trim().trim_matches('"').trim_matches('\'').trim();
                let lowered_arg = clean_arg.to_ascii_lowercase();
                risky.argument_pattern.split('|').any(|p| {
                    let p_low = p.to_ascii_lowercase();
                    if p_low.ends_with('=') {
                        lowered_arg.starts_with(&p_low)
                    } else {
                        p_low == lowered_arg
                            || lowered_arg.starts_with(&format!("{p_low}="))
                            || lowered_arg.starts_with(&format!("{p_low} "))
                    }
                })
            }) {
                return RiskClass::Risky;
            }
        }
    }

    // Git subcommands, config overrides and flags
    if program_name == "git" {
        // R6-H1: refuse any ext:: transport target
        if args.iter().any(|a| {
            let clean = a.trim().trim_matches('"').trim_matches('\'').trim();
            clean.to_ascii_lowercase().starts_with("ext::")
        }) {
            return RiskClass::Risky;
        }

        let mut index = 0;
        let mut subcommand_found = false;
        while index < args.len() {
            let arg = args[index]
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .trim();
            let lowered = arg.to_ascii_lowercase();

            if lowered == "--exec-path" || lowered.starts_with("--exec-path=") {
                return RiskClass::Risky;
            }

            if lowered == "--upload-pack"
                || lowered.starts_with("--upload-pack=")
                || lowered == "--receive-pack"
                || lowered.starts_with("--receive-pack=")
            {
                return RiskClass::Risky;
            }

            if arg == "-c" || lowered == "--config" || lowered == "--config-env" {
                if let Some(val) = args.get(index + 1) {
                    if crate::command_policy::is_risky_git_config(val) {
                        return RiskClass::Risky;
                    }
                    index += 2;
                    continue;
                } else {
                    return RiskClass::Risky;
                }
            } else if let Some(val) = crate::command_policy::git_config_override_value(arg) {
                if crate::command_policy::is_risky_git_config(val) {
                    return RiskClass::Risky;
                }
                index += 1;
                continue;
            }

            if !subcommand_found {
                // R6-H1: refuse --bare anywhere before the subcommand
                if lowered == "--bare" {
                    return RiskClass::Risky;
                }

                if arg == "-C" {
                    if let Some(target) = args.get(index + 1) {
                        let clean_target =
                            target.trim().trim_matches('"').trim_matches('\'').trim();
                        if clean_target != "." && clean_target != "./" {
                            return RiskClass::Risky;
                        }
                    } else {
                        return RiskClass::Risky;
                    }
                    index += 2;
                    continue;
                }
                if arg.starts_with("-C") && arg.len() > 2 {
                    let target = &arg[2..];
                    let clean_target = target.trim().trim_matches('"').trim_matches('\'').trim();
                    if clean_target != "." && clean_target != "./" {
                        return RiskClass::Risky;
                    }
                    index += 1;
                    continue;
                }

                if lowered == "--git-dir" {
                    if let Some(target) = args.get(index + 1) {
                        let clean_target =
                            target.trim().trim_matches('"').trim_matches('\'').trim();
                        let norm = clean_target.replace('\\', "/");
                        if norm != ".git"
                            && norm != "./.git"
                            && norm != ".git/"
                            && norm != "./.git/"
                        {
                            return RiskClass::Risky;
                        }
                    } else {
                        return RiskClass::Risky;
                    }
                    index += 2;
                    continue;
                }
                if lowered.starts_with("--git-dir=") {
                    let target = &arg["--git-dir=".len()..];
                    let clean_target = target.trim().trim_matches('"').trim_matches('\'').trim();
                    let norm = clean_target.replace('\\', "/");
                    if norm != ".git" && norm != "./.git" && norm != ".git/" && norm != "./.git/" {
                        return RiskClass::Risky;
                    }
                    index += 1;
                    continue;
                }

                if lowered == "--work-tree"
                    || lowered == "--namespace"
                    || lowered == "--super-prefix"
                {
                    if args.get(index + 1).is_some() {
                        index += 2;
                        continue;
                    } else {
                        return RiskClass::Risky;
                    }
                }
                if lowered.starts_with("--work-tree=")
                    || lowered.starts_with("--namespace=")
                    || lowered.starts_with("--super-prefix=")
                {
                    index += 1;
                    continue;
                }

                // R6-H1 structural direction: any git global option NOT on the known-safe list
                // must classify Risky instead of being skipped.
                if arg.starts_with('-') {
                    return RiskClass::Risky;
                }

                subcommand_found = true;
                let remaining = &args[index + 1..];

                if matches!(
                    lowered.as_str(),
                    "push"
                        | "pull"
                        | "fetch"
                        | "clone"
                        | "submodule"
                        | "rebase"
                        | "filter-branch"
                        | "apply"
                ) {
                    return RiskClass::Risky;
                }
                if (lowered == "ls-remote" || lowered == "fetch" || lowered == "clone")
                    && remaining.iter().any(|a| {
                        let clean_a = a.trim().trim_matches('"').trim_matches('\'').trim();
                        clean_a == "-u"
                            || (clean_a.starts_with("-u") && clean_a.len() > 2)
                            || clean_a.starts_with("--upload-pack")
                    })
                {
                    return RiskClass::Risky;
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
                    return RiskClass::Risky;
                }
                if (lowered == "init" || lowered == "clone")
                    && remaining.iter().any(|a| {
                        let clean_a = a.trim().trim_matches('"').trim_matches('\'').trim();
                        let a_low = clean_a.to_ascii_lowercase();
                        a_low == "--template" || a_low.starts_with("--template=")
                    })
                {
                    return RiskClass::Risky;
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
                    return RiskClass::Risky;
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
                    return RiskClass::Risky;
                }
                if lowered == "bisect"
                    && remaining.iter().any(|a| {
                        a.trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .eq_ignore_ascii_case("run")
                    })
                {
                    return RiskClass::Risky;
                }
                if lowered == "rebase"
                    && remaining.iter().any(|a| {
                        let a_low = a
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .to_ascii_lowercase();
                        a_low == "-x" || a_low == "--exec" || a_low.starts_with("--exec=")
                    })
                {
                    return RiskClass::Risky;
                }
                if lowered == "submodule"
                    && remaining.iter().any(|a| {
                        a.trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .eq_ignore_ascii_case("foreach")
                    })
                {
                    return RiskClass::Risky;
                }
                if lowered == "archive"
                    && remaining.iter().any(|a| {
                        let a_low = a
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .to_ascii_lowercase();
                        a_low == "--exec" || a_low.starts_with("--exec=")
                    })
                {
                    return RiskClass::Risky;
                }
                if lowered == "config" && is_risky_git_config_subcommand(remaining) {
                    return RiskClass::Risky;
                }
            }

            index += 1;
        }
    }

    // SQLite3 dot-commands that shell out (.shell, .system, .once/.output with pipe, .read, .import, .load, -init).
    if program_name == "sqlite3" {
        for (i, arg) in args.iter().enumerate() {
            if crate::command_policy::is_risky_sqlite3_arg(arg, args.get(i + 1).map(|s| s.as_str()))
            {
                return RiskClass::Risky;
            }
        }
    }

    // Node: safe allow-list ONLY (--version/-v/-V/--help/-h) (R6-H3)
    if program_name == "node" || program_name == "nodejs" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            // Safe flags: ONLY --version/-v/-V/--help/-h
            if clean == "--version"
                || clean == "-v"
                || clean == "-V"
                || clean == "--help"
                || clean == "-h"
            {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // ESLint: ANY invocation Risky (loads configuration files which execute code)
    if program_name == "eslint" {
        return RiskClass::Risky;
    }

    // Javac: ANY invocation Risky (runs annotation processors which execute bytecode)
    if program_name == "javac" {
        return RiskClass::Risky;
    }

    // Rustc: ANY invocation Risky (executes proc macros and compiler plugins)
    if program_name == "rustc" {
        return RiskClass::Risky;
    }

    // Java executing single-file source launch (.java) or application execution
    if program_name == "java" {
        return RiskClass::Risky;
    }

    // CMake: safe allow-list of read-only introspection (R6-H4)
    if program_name == "cmake" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();

            // Safe read-only introspection:
            // --version / -v / -V / --help / -h / --system-information / --help-*
            if clean == "--version"
                || clean == "-v"
                || clean == "-V"
                || clean == "--help"
                || clean == "-h"
                || clean == "--system-information"
                || clean.starts_with("--system-information=")
                || clean.starts_with("--help-")
            {
                continue;
            }

            // Safe cache-list flags: combinations of -L, -A, -H, -N
            if clean.starts_with('-')
                && clean.len() > 1
                && clean[1..]
                    .chars()
                    .all(|c| matches!(c, 'L' | 'A' | 'H' | 'N'))
            {
                continue;
            }

            return RiskClass::Risky;
        }
    }

    // pnpm & yarn: ALL invocations Risky (pnpm executes .pnpmfile.cjs; yarn honors yarnPath) (R6-H6)
    if program_name == "pnpm" || program_name == "yarn" {
        return RiskClass::Risky;
    }

    // npm safe allow-list: bare npm Risky; scans all args (R6-H5)
    if program_name == "npm" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_NPM_SUBCOMMANDS: &[&str] = &[
            "--version",
            "-v",
            "-V",
            "--help",
            "-h",
            "help",
            "list",
            "ls",
            "ll",
            "view",
            "info",
            "outdated",
            "audit",
            "licenses",
            "explain",
            "doctor",
            "ping",
            "prefix",
            "root",
        ];
        let first_lower = args[0]
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim()
            .to_ascii_lowercase();
        let is_view_or_info = first_lower == "view" || first_lower == "info";

        for (i, arg) in args.iter().enumerate() {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_NPM_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            // For `npm view <pkg>` / `npm info <pkg>`, admit the non-flag package name target
            if i > 0 && is_view_or_info && !clean.starts_with('-') {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // PHP: bare php Risky, any file run / code execution Risky; only safe info/version flags allowed
    if program_name == "php" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_PHP_FLAGS: &[&str] = &[
            "--version",
            "-v",
            "-V",
            "--help",
            "-h",
            "-m",
            "--modules",
            "-i",
            "--info",
            "--ini",
        ];
        let only_safe_flags = args.iter().all(|arg| {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            KNOWN_SAFE_PHP_FLAGS.contains(&clean)
        });
        if !only_safe_flags {
            return RiskClass::Risky;
        }
    }

    // Deno: scans all args against safe allow-list (R6-H5)
    if program_name == "deno" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_DENO_SUBCOMMANDS: &[&str] = &[
            "--version",
            "-v",
            "-V",
            "--help",
            "-h",
            "help",
            "info",
            "lint",
            "fmt",
            "check",
            "doc",
        ];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_DENO_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Dotnet: scans all args against safe allow-list (R6-H5)
    if program_name == "dotnet" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_DOTNET_SUBCOMMANDS: &[&str] = &[
            "--version",
            "-v",
            "--help",
            "-h",
            "help",
            "--info",
            "--list-sdks",
            "--list-runtimes",
        ];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_DOTNET_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Cargo: scans all args against safe allow-list; -v removed (R6-H5)
    if program_name == "cargo" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_CARGO_SUBCOMMANDS: &[&str] = &[
            "--version",
            "-V",
            "--help",
            "-h",
            "help",
            "version",
            "tree",
            "metadata",
            "locate-project",
            "read-manifest",
            "verify-project",
            "report",
        ];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_CARGO_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Composer: scans all args against safe allow-list (R6-H5)
    if program_name == "composer" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_COMPOSER_SUBCOMMANDS: &[&str] = &[
            "--version",
            "-v",
            "-V",
            "--help",
            "-h",
            "help",
            "list",
            "info",
            "show",
            "why",
            "why-not",
            "licenses",
            "diagnose",
            "validate",
            "outdated",
            "audit",
            "suggests",
        ];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_COMPOSER_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Maven (mvn): bare mvn Risky; compile/test/package/validate/exec all Risky; safe allow-list
    if program_name == "mvn" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_MVN_FLAGS: &[&str] = &["--version", "-v", "-V", "--help", "-h"];
        let only_safe_flags = args.iter().all(|arg| {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            KNOWN_SAFE_MVN_FLAGS.contains(&clean)
        });
        if !only_safe_flags {
            return RiskClass::Risky;
        }
    }

    // Rails: scans all args against safe allow-list (R6-H5)
    if program_name == "rails" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_RAILS_SUBCOMMANDS: &[&str] = &[
            "--version",
            "-v",
            "-V",
            "--help",
            "-h",
            "help",
            "about",
            "routes",
            "version",
        ];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_RAILS_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Bundle: scans all args against safe allow-list (R6-H5)
    if program_name == "bundle" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_BUNDLE_SUBCOMMANDS: &[&str] =
            &["--version", "-v", "-V", "--help", "-h", "help", "version"];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_BUNDLE_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Go: scans all args against safe allow-list (R6-H5)
    if program_name == "go" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if lowered == "-toolexec"
                || lowered.starts_with("-toolexec=")
                || lowered == "--toolexec"
                || lowered.starts_with("--toolexec=")
                || lowered == "-vettool"
                || lowered.starts_with("-vettool=")
                || lowered == "--vettool"
                || lowered.starts_with("--vettool=")
            {
                return RiskClass::Risky;
            }
        }
        const KNOWN_SAFE_GO_SUBCOMMANDS: &[&str] = &[
            "--version",
            "-v",
            "version",
            "--help",
            "-h",
            "help",
            "env",
            "doc",
        ];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_GO_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Vite / Next: scans all args against safe allow-list (R6-H5)
    if program_name == "vite" || program_name == "next" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_VITE_NEXT_SUBCOMMANDS: &[&str] =
            &["--version", "-v", "-V", "--help", "-h", "help", "info"];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_VITE_NEXT_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Bun: scans all args against safe allow-list (R6-H5)
    if program_name == "bun" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_BUN_SUBCOMMANDS: &[&str] =
            &["--version", "-v", "-V", "--help", "-h", "help"];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_BUN_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // PocketBase: scans all args against safe allow-list (R6-H5)
    if program_name == "pocketbase" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        const KNOWN_SAFE_POCKETBASE_SUBCOMMANDS: &[&str] =
            &["--version", "-v", "-V", "--help", "-h", "help"];
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if KNOWN_SAFE_POCKETBASE_SUBCOMMANDS.contains(&lowered.as_str()) {
                continue;
            }
            if is_safe_pure_flag(&lowered) {
                continue;
            }
            return RiskClass::Risky;
        }
    }

    // Prettier: script forms (--config, --plugin, script files) Risky
    if program_name == "prettier" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        for arg in args {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            let lowered = clean.to_ascii_lowercase();
            if lowered == "--config"
                || lowered.starts_with("--config=")
                || lowered == "--plugin"
                || lowered.starts_with("--plugin=")
                || lowered.ends_with(".js")
                || lowered.ends_with(".mjs")
                || lowered.ends_with(".cjs")
            {
                return RiskClass::Risky;
            }
        }
    }

    // Python executing REPL, scripts, or non-version/help arguments.
    if program_name == "python" || program_name == "python3" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        let only_safe_flags = args.iter().all(|arg| {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            matches!(clean, "--version" | "-v" | "-V" | "--help" | "-h")
        });
        if !only_safe_flags {
            return RiskClass::Risky;
        }
    }

    // Ruby executing REPL, scripts, or non-version/help arguments.
    if program_name == "ruby" {
        if args.is_empty() {
            return RiskClass::Risky;
        }
        let only_safe_flags = args.iter().all(|arg| {
            let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
            matches!(clean, "--version" | "-v" | "--help" | "-h")
        });
        if !only_safe_flags {
            return RiskClass::Risky;
        }
    }

    // Direct writes or references to .git/config (skipping commit messages to avoid R5-L1 false positives)
    let is_git_commit = program_name == "git" && args.iter().any(|a| a == "commit");
    let mut skip_next = false;
    for a in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if is_git_commit && (a == "-m" || a == "-F" || a == "--message" || a == "--file") {
            skip_next = true;
            continue;
        }
        if is_git_commit && (a.starts_with("-m") || a.starts_with("--message=")) {
            continue;
        }
        if crate::command_policy::is_git_config_path(a) {
            return RiskClass::Risky;
        }
    }

    // Writes outside the workspace or deleting >20 files (conservative).
    for arg in args {
        let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
        if clean.starts_with('/') || clean.contains("..") {
            return RiskClass::Risky;
        }
    }

    RiskClass::Safe
}

fn is_risky_git_config_subcommand(args: &[String]) -> bool {
    for arg in args {
        let clean = arg.trim().trim_matches('"').trim_matches('\'').trim();
        if clean.contains('=') {
            return true;
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
                return true;
            }
            i += 1;
            continue;
        }
        positional.push(arg);
        i += 1;
    }

    if !positional.is_empty() {
        let first = positional[0];
        if first.eq_ignore_ascii_case("set") || first.eq_ignore_ascii_case("unset") {
            return true;
        }
        if positional.len() >= 2 {
            return true;
        }
    }

    false
}

/// Maps project permissions to a work protection policy.
pub fn policy_for_permissions(p: ProjectPermissions) -> WorkProtectionPolicy {
    let mode = match (p.confinement, p.approval_mode) {
        (Confinement::ReadOnly, _) => PermissionMode::ReadOnly,
        (Confinement::FullAccess, ApprovalMode::NeverAsk) => PermissionMode::FullAccess,
        (_, ApprovalMode::AskAlways) => PermissionMode::AskAlways,
        (_, ApprovalMode::AskForRisky) => PermissionMode::AskForRisky,
        (_, ApprovalMode::NeverAsk) => PermissionMode::AutoInsideProject,
    };

    WorkProtectionPolicy {
        mode,
        snapshot_before_edit: true,
        worktree_isolation: false,
        read_before_write: true,
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_command() {
        assert_eq!(classify_command("ls", &[]), RiskClass::Safe);
        assert_eq!(classify_command("bash", &[]), RiskClass::Risky);
        assert_eq!(
            classify_command("bash", &["script.sh".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bash", &["-c".to_string(), "id".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(classify_command("curl", &[]), RiskClass::Risky);
        assert_eq!(classify_command("wget", &[]), RiskClass::Risky);
        assert_eq!(classify_command("ssh", &[]), RiskClass::Risky);
        assert_eq!(
            classify_command("git", &["push".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npm", &["install".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["publish".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["publish".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["publish".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bun", &["publish".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npx", &["cowsay".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["dlx".to_string(), "cowsay".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["-e".to_string(), "console.log(1)".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["index.js".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["script.mjs".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["script.cjs".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("nodejs", &["index.js".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("deno", &["run".to_string(), "main.ts".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("php", &["-r".to_string(), "echo 1;".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["b".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["t".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["check".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["clippy".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cat", &["../secret.txt".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cat", &["/etc/passwd".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["run".to_string(), "build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["list".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["--version".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["why".to_string(), "foo".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["--version".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bundle", &["exec".to_string(), "rspec".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("mvn", &["exec:exec".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("mvn", &["-Dexec.executable=bash".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["r".to_string(), "script.rb".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["runner".to_string(), "script.rb".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-P".to_string(), "script.cmake".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-E".to_string(), "env".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["--build".to_string(), ".".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bun", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bun", &["x.ts".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("go", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npm", &["t".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npm", &["rebuild".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".shell whoami".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".system whoami".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".output |cat".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".once |sh".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), "SELECT 1;".to_string()]
            ),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "bisect".to_string(),
                    "run".to_string(),
                    "./test.sh".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("git", &["bisect".to_string(), "start".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("pnpm", &["run".to_string(), "build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["exec".to_string(), "foo".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["run".to_string(), "build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["exec".to_string(), "foo".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npm", &["x".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npm", &["start".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npm", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npm", &["run-script".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["r".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["b".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["-p".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["--print".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("nodejs", &["-p".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bun", &["-e".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["task".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("go", &["generate".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-E".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["runner".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["run".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("git", &["rebase".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("git", &["submodule".to_string()]),
            RiskClass::Risky
        );
    }

    #[test]
    fn risky_commands_are_classified_as_risky() {
        for risky in RISKY_COMMANDS {
            let args = if risky.argument_pattern == "*" {
                vec!["arg".to_string()]
            } else {
                vec![risky
                    .argument_pattern
                    .split('|')
                    .next()
                    .unwrap()
                    .to_string()]
            };
            assert_eq!(
                classify_command(risky.program, &args),
                RiskClass::Risky,
                "{} with args {:?} should be risky",
                risky.program,
                args
            );
        }
    }
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
