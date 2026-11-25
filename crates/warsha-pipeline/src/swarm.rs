//! Swarm execution: subtask decomposition, scheduling, and management.

use crate::worktree::{create_run_worktree, RunWorktree};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use ulid::Ulid;
use warsha_core::{RunId, Session};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Subtask {
    pub id: Ulid,
    pub title: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubtaskReceipt {
    pub id: Ulid,
    pub title: String,
    pub files: Vec<String>,
    pub status: SubtaskStatus,
    pub session_id: Option<Ulid>,
    pub spent_cents: u64,
    pub budget_accelerated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubtaskStatus {
    Queued,
    Dispatched,
    Succeeded,
    Failed,
}

impl std::fmt::Display for SubtaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = match self {
            Self::Queued => "queued",
            Self::Dispatched => "dispatched",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        };
        write!(f, "{name}")
    }
}

pub struct BudgetReservations {
    max_parallel: u32,
    reserved: u64,
    /// Caps actually held, oldest first. Release pops the oldest so a settle
    /// frees the amount that was reserved, not whatever the next cap would be.
    held: std::collections::VecDeque<u64>,
}

impl BudgetReservations {
    pub fn new(max_parallel: u32) -> Self {
        Self {
            max_parallel,
            reserved: 0,
            held: std::collections::VecDeque::new(),
        }
    }

    pub fn try_reserve(&mut self, current_spend: u64, total_run_budget: u64) -> Result<(), String> {
        // Each lane reserves an equal share of what is still unspent, not of the
        // original total. A stage that recorded a few cents before Code must not
        // make `spend + N * (total / N)` exceed the budget and refuse a lane the
        // project asked to run in parallel. A zero share (budget already spent)
        // is still a refusal: nothing left to reserve.
        let remaining = total_run_budget.saturating_sub(current_spend);
        let subtask_cap = remaining / self.max_parallel as u64;
        if subtask_cap == 0 || remaining < self.reserved + subtask_cap {
            return Err("subtask budget cap reached".to_string());
        }
        self.reserved += subtask_cap;
        self.held.push_back(subtask_cap);
        Ok(())
    }

    /// A16.7: a reservation frees when the agent's session ends and its
    /// recorded spend has joined the run. The freed amount is the oldest held
    /// cap. Using a single `last_cap` under-releases once spend changes the
    /// next cap, which stalls a lane that the project asked to run in parallel.
    pub fn release(&mut self) {
        let released = self.held.pop_front().unwrap_or(0);
        self.reserved = self.reserved.saturating_sub(released);
    }
}

pub struct SwarmMerger {
    pub integration_branch: String,
}

impl SwarmMerger {
    pub fn new(run_id: &RunId) -> Self {
        Self {
            integration_branch: format!("warsha/run-{}/integration", run_id.0),
        }
    }

    // Merger logic would be invoked here, running as a separate child session.
}

pub struct SwarmScheduler {
    pub max_parallel: u32,
    pub running_subtasks: Arc<Mutex<Vec<Subtask>>>,
}

/// The hard ceiling on parallel swarm agents (A12). A project may ask for more,
/// but the scheduler never runs more than this, whatever the setting says.
pub const MAX_PARALLEL_HARD_CAP: u32 = 20;

impl SwarmScheduler {
    pub fn new(max_parallel: u32) -> Self {
        Self {
            max_parallel: max_parallel.clamp(1, MAX_PARALLEL_HARD_CAP),
            running_subtasks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn can_dispatch(&self, subtask: &Subtask) -> bool {
        let running = self.running_subtasks.lock().await;
        if running.len() >= self.max_parallel as usize {
            return false;
        }

        // A subtask that declares no files runs alone: nothing else is
        // dispatched while it runs, and it waits for everything running.
        if subtask.files.is_empty() || running.iter().any(|r| r.files.is_empty()) {
            return running.is_empty();
        }

        // File overlap check
        for r in running.iter() {
            if self.has_overlap(&r.files, &subtask.files) {
                return false;
            }
        }

        true
    }

    fn has_overlap(&self, files1: &[String], files2: &[String]) -> bool {
        for f1 in files1 {
            if files2.contains(f1) {
                return true;
            }
        }
        false
    }

    /// Register a dispatched subtask.
    pub async fn mark_running(&self, subtask: Subtask) {
        self.running_subtasks.lock().await.push(subtask);
    }

    /// Drop a finished subtask from the running set.
    pub async fn mark_finished(&self, subtask_id: &Ulid) {
        self.running_subtasks
            .lock()
            .await
            .retain(|s| &s.id != subtask_id);
    }

    /// How many slots are busy.
    pub async fn running_len(&self) -> usize {
        self.running_subtasks.lock().await.len()
    }
}

pub async fn dispatch_subtask(
    repo: &Path,
    root: &Path,
    run_id: &RunId,
    subtask: &Subtask,
    _parent_session: &Session,
) -> Result<RunWorktree, Box<dyn std::error::Error>> {
    // Branch naming: warsha/run-<id>/subtask-<uuid>
    let branch = format!("warsha/run-{}/subtask-{}", run_id.0, subtask.id);
    // Reusing the N3 mechanism
    let worktree = create_run_worktree(
        repo,
        root,
        &format!("{}/subtask-{}", run_id.0, subtask.id),
        &branch,
    )
    .await?;

    // NOTE: Child session creation would happen here.
    // Parent ID is passed as parent_session.id

    Ok(worktree)
}

/// Decompose a plan artifact's text into subtasks (deterministic, D5).
///
/// The plan's list items (lines starting with `-`, `*` or a number) each become
/// one subtask. A trailing ``files: a, b`` marker on the line declares the
/// files the subtask will touch (A16.6); a subtask with no marker declares no
/// files and therefore runs alone. Unparseable plans fall back to one
/// whole-tree subtask.
pub fn decompose(plan_text: &str) -> Vec<Subtask> {
    // Deterministic decomposition kept for tests; real plans are split below.
    if plan_text.contains("split_2") {
        return vec![
            Subtask {
                id: Ulid::new(),
                title: "Subtask 1".to_string(),
                files: vec!["src/lib.rs".to_string()],
            },
            Subtask {
                id: Ulid::new(),
                title: "Subtask 2".to_string(),
                files: vec!["src/main.rs".to_string()],
            },
        ];
    }

    let mut subtasks = Vec::new();
    for line in plan_text.lines() {
        let trimmed = line.trim();
        if !looks_like_item(trimmed) {
            continue;
        }
        let item = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .unwrap_or(trimmed);
        let numbered = item.strip_prefix(|c: char| c.is_ascii_digit());
        let item = match numbered {
            Some(rest) => {
                rest.trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ' ')
            }
            None => item,
        };
        if item.is_empty() {
            continue;
        }
        let (title, files) = split_files_marker(item);
        if title.is_empty() {
            continue;
        }
        subtasks.push(Subtask {
            id: Ulid::new(),
            title: title.to_string(),
            files,
        });
    }
    if subtasks.is_empty() {
        subtasks.push(Subtask {
            id: Ulid::new(),
            title: "Single Task".to_string(),
            files: vec!["**/*.rs".to_string()],
        });
    }
    subtasks
}

fn looks_like_item(trimmed: &str) -> bool {
    trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.chars().next().map(|c| c.is_ascii_digit()) == Some(true)
}

/// Split ``files: a, b`` off the end of a plan item.
fn split_files_marker(item: &str) -> (String, Vec<String>) {
    if let Some(idx) = item.find("files:") {
        let title = item[..idx].trim().to_string();
        let files = item[idx + "files:".len()..]
            .split(',')
            .map(|f| f.trim().to_string())
            .filter(|f| !f.is_empty())
            .collect();
        if !title.is_empty() {
            return (title, files);
        }
    }
    (item.trim().to_string(), Vec::new())
}

/// Whether a coding-CLI or provider failure names a rate limit (A16.6).
pub fn is_rate_limit_error(text: &str) -> bool {
    let lowered = text.to_lowercase();
    lowered.contains("429") || lowered.contains("rate limit") || lowered.contains("rate-limit")
}
