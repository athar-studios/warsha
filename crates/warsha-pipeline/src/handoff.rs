//! Continue on server — hand a run to a remote `warshad`, watch it from the
//! phone, then bring the changes back file by file (PLAN.md M6a; LingCode
//! inspired the idea, no code, text or asset was copied from it).
//!
//! Two halves, both side-effect free:
//!
//! - [`HandoffState`] / [`HandoffManager`] — the lifecycle of one handoff:
//!   `idle` → `preparing` → `handed_off` → `applying` → `applied`, with a
//!   failure state reachable from any step.
//! - [`HandoffBundle`] / [`HandoffFile`] — the payload that travels to the
//!   remote daemon and back; every file carries a checksum of its own content.
//!
//! Nothing here touches the filesystem, the network or the event store. That is
//! deliberate: [`HandoffManager::apply_bundle`] decides *what* would change
//! (`applied`, `conflicts`, `backups`) and the caller writes the files and takes
//! the backup. So "review & apply" is a dry run until the owner presses the
//! button, and the conflict rules are testable without a temp directory.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// FNV-1a, 64-bit, over the UTF-8 bytes of `content`, as 16 lowercase hex digits.
///
/// A checksum here answers "did these bytes change", not "did someone forge
/// them". It is the integrity check for a bundle that travelled through the
/// relay (and possibly a sleep or a reconnect): cheap, deterministic, and
/// dependency-free — this crate has no digest library, and the milestone adds
/// no dependency.
pub fn content_checksum(content: &str) -> String {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET_BASIS;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:016x}")
}

/// The name a backup bundle takes for a run, so the apply and the notice the
/// owner reads agree on one string.
pub fn backup_bundle_name(run_id: &str) -> String {
    format!("warsha-backup-{run_id}")
}

/// One file inside a [`HandoffBundle`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HandoffFile {
    /// Path relative to the project root.
    pub path: String,
    /// Full file contents (not a diff), so an apply needs no second remote call.
    pub content: String,
    /// [`content_checksum`] of `content` at the moment the file was captured.
    pub checksum: String,
}

impl HandoffFile {
    /// Capture a file, computing its checksum from the content it is given.
    pub fn new(path: impl Into<String>, content: impl Into<String>) -> Self {
        let content = content.into();
        let checksum = content_checksum(&content);
        Self {
            path: path.into(),
            content,
            checksum,
        }
    }

    /// Whether `checksum` still describes `content`.
    ///
    /// An apply refuses a bundle where any file fails this, so a payload that
    /// was truncated or re-assembled wrong never reaches the working tree.
    pub fn is_intact(&self) -> bool {
        self.checksum == content_checksum(&self.content)
    }
}

/// Everything one handoff carries: the run it belongs to and its files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HandoffBundle {
    /// The local run that was handed off.
    pub run_id: String,
    /// The files the run produced, in the order they were captured.
    pub files: Vec<HandoffFile>,
}

impl HandoffBundle {
    /// Every path in the bundle, in bundle order.
    pub fn paths(&self) -> Vec<&str> {
        self.files.iter().map(|file| file.path.as_str()).collect()
    }

    /// The file at `path`, matching the same way an apply matches local files.
    pub fn file(&self, path: &str) -> Option<&HandoffFile> {
        let wanted = normalize_path(path);
        self.files
            .iter()
            .find(|file| normalize_path(&file.path) == wanted)
    }

    /// Whether the bundle carries no files at all.
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

/// Where one handoff is in its lifecycle.
///
/// The serialized `state` tag matches the `HandoffPhase` union in
/// `apps/desktop/src/components/HandoffDialog.tsx`, so the desktop reads a
/// daemon value without a translation table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "state", content = "detail", rename_all = "snake_case")]
pub enum HandoffState {
    /// Nothing handed off; the run is local.
    #[default]
    Idle,
    /// The bundle is being built to send.
    Preparing,
    /// The remote daemon accepted the run and keeps it alive.
    HandedOff {
        /// The remote run's identifier, used in the event stream and the PWA.
        remote_run_id: String,
        /// The remote daemon's URL, as the owner entered it.
        remote_url: String,
    },
    /// Changes are coming back and are being reviewed.
    Applying,
    /// The changes were applied; the bundle can be dropped.
    Applied,
    /// Something stopped the handoff, with the reason to show the owner.
    Failed(String),
}

impl HandoffState {
    /// The lowercase name this state serializes as.
    pub fn label(&self) -> &'static str {
        match self {
            HandoffState::Idle => "idle",
            HandoffState::Preparing => "preparing",
            HandoffState::HandedOff { .. } => "handed_off",
            HandoffState::Applying => "applying",
            HandoffState::Applied => "applied",
            HandoffState::Failed(_) => "failed",
        }
    }

    /// The remote run id and URL, once the handoff reached the remote daemon.
    pub fn remote(&self) -> Option<(&str, &str)> {
        match self {
            HandoffState::HandedOff {
                remote_run_id,
                remote_url,
            } => Some((remote_run_id.as_str(), remote_url.as_str())),
            _ => None,
        }
    }

    /// The failure reason, when the handoff failed.
    pub fn failure(&self) -> Option<&str> {
        match self {
            HandoffState::Failed(reason) => Some(reason.as_str()),
            _ => None,
        }
    }
}

/// One file both sides changed, and what each side now holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conflict {
    /// The path that disagrees.
    pub path: String,
    /// Checksum of the file as it is on this machine right now.
    pub local_checksum: String,
    /// Checksum of what the remote run produced.
    pub remote_checksum: String,
}

/// How an apply resolves what it finds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyOptions {
    /// Owner-wins. On a conflict the local file stays and the remote change is
    /// dropped, recorded in [`ApplyResult::resolved`] rather than discarded
    /// silently. Off means remote-wins: the local file is backed up, then the
    /// remote content is written.
    pub owner_wins: bool,
    /// `None` applies every file in the bundle; `Some(paths)` applies only
    /// those, which is what the review panel's "Apply selected" sends.
    pub selected: Option<Vec<String>>,
}

impl Default for ApplyOptions {
    /// The shipped rule: the owner's file wins a conflict, and every file in the
    /// bundle is a candidate.
    fn default() -> Self {
        Self {
            owner_wins: true,
            selected: None,
        }
    }
}

impl ApplyOptions {
    /// Apply every file, with the given conflict rule.
    pub fn all(owner_wins: bool) -> Self {
        Self {
            owner_wins,
            selected: None,
        }
    }

    /// Apply only `paths`, with the given conflict rule.
    pub fn selected<P: Into<String>>(paths: impl IntoIterator<Item = P>, owner_wins: bool) -> Self {
        Self {
            owner_wins,
            selected: Some(paths.into_iter().map(Into::into).collect()),
        }
    }

    /// Whether `path` is in scope for this apply.
    pub fn selects(&self, path: &str) -> bool {
        match &self.selected {
            None => true,
            Some(paths) => paths
                .iter()
                .any(|want| normalize_path(want) == normalize_path(path)),
        }
    }
}

/// What an apply decided, before anything is written.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplyResult {
    /// Paths whose content should be the remote content after the apply.
    pub applied: Vec<String>,
    /// Files both sides changed. Recorded whatever the conflict rule decides, so
    /// the owner always sees what disagreed.
    pub conflicts: Vec<Conflict>,
    /// Paths whose current local content must be kept before it is overwritten.
    pub backups: Vec<String>,
    /// Conflicts that owner-wins kept on the local side.
    pub resolved: Vec<String>,
}

impl ApplyResult {
    /// Whether the apply would write, back up or resolve nothing.
    pub fn is_empty(&self) -> bool {
        self.applied.is_empty()
            && self.conflicts.is_empty()
            && self.backups.is_empty()
            && self.resolved.is_empty()
    }

    /// Whether any file disagreed between the two sides.
    pub fn has_conflicts(&self) -> bool {
        !self.conflicts.is_empty()
    }

    /// The conflicts the conflict rule did not settle, e.g. remote-wins
    /// overwrote a local edit and the owner has to sign off at a gate.
    pub fn unresolved(&self) -> Vec<&Conflict> {
        self.conflicts
            .iter()
            .filter(|conflict| !self.resolved.contains(&conflict.path))
            .collect()
    }

    /// Whether a gate has to be raised before this apply is trusted.
    ///
    /// Owner-wins settles every conflict it meets, so nothing is left over;
    /// remote-wins overwrites a local edit, which the owner must see.
    pub fn requires_gate(&self) -> bool {
        !self.unresolved().is_empty()
    }
}

/// Errors raised by the handoff layer.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum HandoffError {
    /// A bundled file no longer matches the checksum it carried.
    #[error("file `{path}` does not match its checksum")]
    ChecksumMismatch {
        /// The file whose content and checksum disagree.
        path: String,
    },
    /// The bundle cannot be applied as given.
    #[error("invalid handoff bundle: {0}")]
    InvalidBundle(String),
    /// The handoff cannot move from its current state to the requested one.
    #[error("cannot move the handoff from `{from}` to `{to}`")]
    InvalidTransition {
        /// The state the handoff is in.
        from: String,
        /// The state that was requested.
        to: String,
    },
}

/// Drives one handoff and decides what an apply would change.
#[derive(Debug, Clone, Default)]
pub struct HandoffManager {
    state: HandoffState,
}

impl HandoffManager {
    /// A manager for a run that is still local.
    pub fn new() -> Self {
        Self::default()
    }

    /// The current state.
    pub fn state(&self) -> &HandoffState {
        &self.state
    }

    /// The remote run id, once the handoff reached the remote daemon.
    pub fn remote_run_id(&self) -> Option<&str> {
        self.state.remote().map(|(run_id, _)| run_id)
    }

    /// The remote daemon URL, once the handoff reached it.
    pub fn remote_url(&self) -> Option<&str> {
        self.state.remote().map(|(_, url)| url)
    }

    /// Start building a handoff. Allowed from `idle` and from `failed`, so a
    /// transient network failure does not strand the run.
    pub fn begin(&mut self) -> Result<(), HandoffError> {
        if !matches!(self.state, HandoffState::Idle | HandoffState::Failed(_)) {
            return Err(self.transition_error("preparing"));
        }
        self.state = HandoffState::Preparing;
        Ok(())
    }

    /// Record that the remote daemon accepted the run.
    pub fn handed_off(
        &mut self,
        remote_run_id: impl Into<String>,
        remote_url: impl Into<String>,
    ) -> Result<(), HandoffError> {
        if !matches!(self.state, HandoffState::Preparing) {
            return Err(self.transition_error("handed_off"));
        }
        self.state = HandoffState::HandedOff {
            remote_run_id: remote_run_id.into(),
            remote_url: remote_url.into(),
        };
        Ok(())
    }

    /// Start bringing the changes back.
    pub fn begin_apply(&mut self) -> Result<(), HandoffError> {
        if !matches!(self.state, HandoffState::HandedOff { .. }) {
            return Err(self.transition_error("applying"));
        }
        self.state = HandoffState::Applying;
        Ok(())
    }

    /// Record that the reviewed changes were applied.
    pub fn finish_apply(&mut self) -> Result<(), HandoffError> {
        if !matches!(self.state, HandoffState::Applying) {
            return Err(self.transition_error("applied"));
        }
        self.state = HandoffState::Applied;
        Ok(())
    }

    /// Park the handoff on a failure. Reachable from any state, because every
    /// step can fail, and it replaces an earlier reason rather than keeping it.
    pub fn fail(&mut self, reason: impl Into<String>) {
        self.state = HandoffState::Failed(reason.into());
    }

    /// Forget the handoff and go back to a local run.
    pub fn reset(&mut self) {
        self.state = HandoffState::Idle;
    }

    /// Capture a bundle for `run_id`, computing each file's checksum.
    ///
    /// Validation is [`HandoffManager::apply_bundle`]'s job, so a bundle is
    /// captured exactly as the caller describes it and an empty one is legal:
    /// a remote run that produced no files still needs its lifecycle.
    pub fn create_bundle(&self, run_id: &str, files: &[(&str, &str)]) -> HandoffBundle {
        HandoffBundle {
            run_id: run_id.to_string(),
            files: files
                .iter()
                .map(|(path, content)| HandoffFile::new(*path, *content))
                .collect(),
        }
    }

    /// Decide what applying `bundle` would do to `local_files`.
    ///
    /// `local_files` is the working tree as it is now, as `(path, content)`
    /// pairs. A path absent from it is a new file; a path whose content hashes to
    /// the bundled checksum is already what the remote run produced; anything
    /// else is a [`Conflict`].
    ///
    /// The whole bundle is refused when one file fails its checksum, so an apply
    /// never writes half a tree.
    pub fn apply_bundle(
        &self,
        bundle: &HandoffBundle,
        local_files: &[(&str, &str)],
        options: &ApplyOptions,
    ) -> Result<ApplyResult, HandoffError> {
        validate_bundle(bundle)?;

        for file in &bundle.files {
            if !file.is_intact() {
                return Err(HandoffError::ChecksumMismatch {
                    path: file.path.clone(),
                });
            }
        }

        let mut result = ApplyResult::default();

        for file in &bundle.files {
            if !options.selects(&file.path) {
                continue;
            }

            let local = local_files
                .iter()
                .find(|(path, _)| normalize_path(path) == normalize_path(&file.path));

            let Some((_, local_content)) = local else {
                // A file the local tree does not have: nothing to overwrite and
                // nothing to back up.
                result.applied.push(file.path.clone());
                continue;
            };

            let local_checksum = content_checksum(local_content);
            if local_checksum == file.checksum {
                // Both sides already agree, so the apply is a no-op for this
                // file: it lands in `applied`, but no backup is taken.
                result.applied.push(file.path.clone());
                continue;
            }

            result.conflicts.push(Conflict {
                path: file.path.clone(),
                local_checksum,
                remote_checksum: file.checksum.clone(),
            });
            // Whichever side wins, the local content has to survive the apply.
            result.backups.push(file.path.clone());

            if options.owner_wins {
                result.resolved.push(file.path.clone());
            } else {
                result.applied.push(file.path.clone());
            }
        }

        Ok(result)
    }

    fn transition_error(&self, to: &'static str) -> HandoffError {
        HandoffError::InvalidTransition {
            from: self.state.label().to_string(),
            to: to.to_string(),
        }
    }
}

/// A bundle is applied as one unit, so an empty path or a repeated path is a
/// defect in whatever built it rather than something to guess around.
fn validate_bundle(bundle: &HandoffBundle) -> Result<(), HandoffError> {
    if bundle.run_id.trim().is_empty() {
        return Err(HandoffError::InvalidBundle(
            "the bundle has no run id".to_string(),
        ));
    }

    let mut seen: HashSet<&str> = HashSet::new();
    for file in &bundle.files {
        if file.path.trim().is_empty() {
            return Err(HandoffError::InvalidBundle(
                "a file path must not be empty".to_string(),
            ));
        }
        if !seen.insert(normalize_path(&file.path)) {
            return Err(HandoffError::InvalidBundle(format!(
                "`{}` appears twice in the bundle",
                file.path
            )));
        }
    }

    Ok(())
}

/// Bundles and working trees both spell a path `src/main.rs` and `./src/main.rs`,
/// so both forms have to resolve to the same file.
fn normalize_path(path: &str) -> &str {
    let trimmed = path.trim();
    trimmed.strip_prefix("./").unwrap_or(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle_with(files: &[(&str, &str)]) -> HandoffBundle {
        HandoffManager::new().create_bundle("run-1", files)
    }

    #[test]
    fn create_bundle_captures_content_and_checksums() {
        let manager = HandoffManager::new();
        let bundle = manager.create_bundle(
            "run-1",
            &[("src/main.rs", "fn main() {}\n"), ("docs/notes.md", "")],
        );

        assert_eq!(bundle.run_id, "run-1");
        assert_eq!(bundle.paths(), vec!["src/main.rs", "docs/notes.md"]);
        assert!(!bundle.is_empty());
        assert_eq!(bundle.files[0].content, "fn main() {}\n");
        assert_eq!(bundle.files[0].checksum, content_checksum("fn main() {}\n"));
        // The checksum is 16 hex digits in both cases, empty content included.
        assert_eq!(bundle.files[1].checksum.len(), 16);
        assert_eq!(bundle.files[1].checksum, content_checksum(""));
        assert!(bundle.files.iter().all(HandoffFile::is_intact));
        assert_eq!(
            bundle.file("./src/main.rs").map(|file| file.path.as_str()),
            Some("src/main.rs")
        );
        assert!(bundle.file("src/other.rs").is_none());
        assert_eq!(backup_bundle_name("run-1"), "warsha-backup-run-1");
    }

    #[test]
    fn apply_without_conflicts_writes_new_files_and_leaves_identical_ones() {
        let bundle = bundle_with(&[("src/new.rs", "pub fn new() {}\n"), ("README.md", "# x\n")]);
        let result = HandoffManager::new()
            .apply_bundle(
                &bundle,
                // The readme is already what the remote produced.
                &[("README.md", "# x\n")],
                &ApplyOptions::default(),
            )
            .expect("apply the bundle");

        assert_eq!(result.applied, vec!["src/new.rs", "README.md"]);
        assert!(result.conflicts.is_empty());
        assert!(result.backups.is_empty());
        assert!(!result.has_conflicts());
        assert!(!result.requires_gate());
        assert!(!result.is_empty());
    }

    #[test]
    fn apply_conflict_owner_wins_keeps_the_local_file_and_records_it() {
        let bundle = bundle_with(&[("src/lib.rs", "remote\n")]);
        let result = HandoffManager::new()
            .apply_bundle(
                &bundle,
                &[("src/lib.rs", "local edit\n")],
                &ApplyOptions::all(true),
            )
            .expect("apply the bundle");

        assert_eq!(result.applied, Vec::<String>::new());
        assert_eq!(result.resolved, vec!["src/lib.rs"]);
        assert_eq!(result.backups, vec!["src/lib.rs"]);
        assert!(result.has_conflicts());
        // The conflict is recorded with both sides' checksums.
        assert_eq!(
            result.conflicts,
            vec![Conflict {
                path: "src/lib.rs".to_string(),
                local_checksum: content_checksum("local edit\n"),
                remote_checksum: content_checksum("remote\n"),
            }]
        );
        // Owner-wins settles it, so no gate is raised.
        assert!(!result.requires_gate());
        assert!(result.unresolved().is_empty());
    }

    #[test]
    fn apply_conflict_remote_wins_overwrites_and_keeps_the_conflict_on_record() {
        let bundle = bundle_with(&[("src/lib.rs", "remote\n")]);
        let result = HandoffManager::new()
            .apply_bundle(
                &bundle,
                &[("src/lib.rs", "local edit\n")],
                &ApplyOptions::all(false),
            )
            .expect("apply the bundle");

        assert_eq!(result.applied, vec!["src/lib.rs"]);
        assert!(result.resolved.is_empty());
        // The local content is kept before it is overwritten.
        assert_eq!(result.backups, vec!["src/lib.rs"]);
        assert!(result.has_conflicts());
        assert_eq!(result.unresolved().len(), 1);
        assert_eq!(result.unresolved()[0].path, "src/lib.rs");
        // Overwriting a local edit is what the owner has to sign off at a gate.
        assert!(result.requires_gate());
    }

    #[test]
    fn apply_refuses_a_bundle_whose_checksum_no_longer_matches() {
        let mut bundle = bundle_with(&[("src/lib.rs", "remote\n"), ("src/ok.rs", "fine\n")]);
        // A payload re-assembled wrong: the checksum still says the old content.
        bundle.files[0].content = "tampered\n".to_string();

        let error = HandoffManager::new()
            .apply_bundle(&bundle, &[], &ApplyOptions::default())
            .expect_err("a broken checksum must refuse the apply");
        assert_eq!(
            error,
            HandoffError::ChecksumMismatch {
                path: "src/lib.rs".to_string()
            }
        );
        assert!(!bundle.files[0].is_intact());
        // The intact file is not applied either: no half-written tree.
        assert!(bundle.files[1].is_intact());
    }

    #[test]
    fn apply_of_an_empty_bundle_decides_nothing() {
        let bundle = bundle_with(&[]);
        assert!(bundle.is_empty());

        let result = HandoffManager::new()
            .apply_bundle(
                &bundle,
                &[("src/lib.rs", "local\n")],
                &ApplyOptions::default(),
            )
            .expect("an empty bundle applies cleanly");

        assert!(result.is_empty());
        assert!(!result.has_conflicts());
        assert!(!result.requires_gate());
    }

    #[test]
    fn apply_honours_the_selected_paths() {
        let bundle = bundle_with(&[("a.rs", "a\n"), ("b.rs", "b\n"), ("c.rs", "c\n")]);
        let result = HandoffManager::new()
            .apply_bundle(
                &bundle,
                &[],
                &ApplyOptions::selected(vec!["./c.rs", "a.rs"], true),
            )
            .expect("apply the selected files");

        // Bundle order is kept, not the order the selection arrived in.
        assert_eq!(result.applied, vec!["a.rs", "c.rs"]);
        assert!(ApplyOptions::selected(vec!["a.rs"], true).selects("./a.rs"));
        assert!(!ApplyOptions::selected(vec!["a.rs"], true).selects("b.rs"));
        assert!(ApplyOptions::all(false).selects("anything.sql"));
    }

    #[test]
    fn apply_rejects_malformed_bundles() {
        let manager = HandoffManager::new();

        let duplicate = HandoffBundle {
            run_id: "run-1".to_string(),
            files: vec![
                HandoffFile::new("a.rs", "1"),
                HandoffFile::new("./a.rs", "2"),
            ],
        };
        assert_eq!(
            manager.apply_bundle(&duplicate, &[], &ApplyOptions::default()),
            Err(HandoffError::InvalidBundle(
                "`./a.rs` appears twice in the bundle".to_string()
            ))
        );

        let unnamed = HandoffBundle {
            run_id: "run-1".to_string(),
            files: vec![HandoffFile::new("  ", "1")],
        };
        assert!(matches!(
            manager.apply_bundle(&unnamed, &[], &ApplyOptions::default()),
            Err(HandoffError::InvalidBundle(_))
        ));

        let runless = HandoffBundle {
            run_id: String::new(),
            files: Vec::new(),
        };
        assert!(matches!(
            manager.apply_bundle(&runless, &[], &ApplyOptions::default()),
            Err(HandoffError::InvalidBundle(_))
        ));
    }

    #[test]
    fn the_state_machine_follows_the_handoff_flow() {
        let mut manager = HandoffManager::new();
        assert_eq!(manager.state(), &HandoffState::Idle);
        assert!(manager.remote_run_id().is_none());

        manager.begin().expect("idle starts preparing");
        assert_eq!(manager.state().label(), "preparing");
        assert!(manager.state().remote().is_none());

        manager
            .handed_off("remote-run-7", "https://warsha.example.com")
            .expect("preparing reaches the remote daemon");
        assert_eq!(manager.remote_run_id(), Some("remote-run-7"));
        assert_eq!(manager.remote_url(), Some("https://warsha.example.com"));

        manager.begin_apply().expect("the changes come back");
        manager.finish_apply().expect("the changes were applied");
        assert_eq!(manager.state(), &HandoffState::Applied);

        // Going back to the start is explicit, not automatic.
        manager.reset();
        assert_eq!(manager.state(), &HandoffState::Idle);
    }

    #[test]
    fn an_illegal_transition_is_rejected_and_failure_is_reachable_from_anywhere() {
        let mut manager = HandoffManager::new();

        let skipped = manager
            .begin_apply()
            .expect_err("cannot apply before a handoff");
        assert_eq!(
            skipped,
            HandoffError::InvalidTransition {
                from: "idle".to_string(),
                to: "applying".to_string(),
            }
        );

        manager.begin().expect("idle starts preparing");
        let early = manager
            .finish_apply()
            .expect_err("cannot finish an apply that never started");
        assert!(matches!(early, HandoffError::InvalidTransition { .. }));

        manager.fail("the remote daemon did not answer");
        assert_eq!(
            manager.state().failure(),
            Some("the remote daemon did not answer")
        );

        // A failure is recoverable: the owner retries and lands in preparing.
        manager.begin().expect("failed retries");
        assert_eq!(manager.state().label(), "preparing");
        manager.fail("the relay dropped the frame again");
        assert_eq!(
            manager.state().failure(),
            Some("the relay dropped the frame again")
        );
    }

    #[test]
    fn the_state_and_bundle_survive_serde() {
        let handed_off = HandoffState::HandedOff {
            remote_run_id: "remote-run-7".to_string(),
            remote_url: "https://warsha.example.com".to_string(),
        };
        let encoded = serde_json::to_string(&handed_off).expect("serialize state");
        assert!(encoded.contains("\"state\":\"handed_off\""));
        assert!(encoded.contains("\"remote_run_id\":\"remote-run-7\""));
        assert_eq!(
            serde_json::from_str::<HandoffState>(&encoded).expect("deserialize state"),
            handed_off
        );

        // The `state` tag is what the desktop's HandoffPhase union reads, and a
        // unit variant carries the same tag as a payload variant.
        assert_eq!(
            serde_json::to_string(&HandoffState::Applied).expect("serialize state"),
            "{\"state\":\"applied\"}"
        );
        assert_eq!(HandoffState::default(), HandoffState::Idle);
        assert_eq!(HandoffState::Failed("boom".to_string()).label(), "failed");

        let bundle = bundle_with(&[("a.rs", "a\n")]);
        let encoded = serde_json::to_string(&bundle).expect("serialize bundle");
        let decoded: HandoffBundle = serde_json::from_str(&encoded).expect("deserialize bundle");
        assert_eq!(decoded, bundle);

        let result = ApplyResult {
            applied: vec!["a.rs".to_string()],
            conflicts: vec![Conflict {
                path: "b.rs".to_string(),
                local_checksum: content_checksum("local"),
                remote_checksum: content_checksum("remote"),
            }],
            backups: vec!["b.rs".to_string()],
            resolved: Vec::new(),
        };
        let encoded = serde_json::to_string(&result).expect("serialize result");
        assert_eq!(
            serde_json::from_str::<ApplyResult>(&encoded).expect("deserialize result"),
            result
        );
    }
}
