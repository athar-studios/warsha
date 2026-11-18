//! Run subtasks — the swarm decomposition rows for one run's Code stage (D5).

use crate::{RunId, SessionId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ulid::Ulid;

/// One decomposed subtask of a run's Code stage.
///
/// The swarm scheduler dispatches subtasks as child sessions, each in its own
/// worktree, never exceeding the project's max-parallel setting and never
/// running two subtasks whose declared files overlap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunSubtask {
    pub id: Ulid,
    pub run_id: RunId,
    pub session_id: Option<SessionId>,
    pub title: String,
    /// The files this subtask declares it will touch (A16.6). An empty list
    /// means the subtask runs alone: nothing else is dispatched while it runs.
    pub files: Vec<String>,
    pub status: RunSubtaskStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lifecycle of one subtask.
///
/// `Conflicted` is the queue return: a subtask whose merge conflicted goes back
/// to `Queued` for at most two re-dispatches before it is reported unmerged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RunSubtaskStatus {
    #[default]
    Queued,
    Dispatched,
    Succeeded,
    Failed,
    Conflicted,
    Unmerged,
}

impl std::fmt::Display for RunSubtaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = match self {
            Self::Queued => "queued",
            Self::Dispatched => "dispatched",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Conflicted => "conflicted",
            Self::Unmerged => "unmerged",
        };
        write!(f, "{name}")
    }
}

/// The subtask statuses a row in the `run_subtasks` table may carry.
pub fn parse_subtask_status(raw: &str) -> Option<RunSubtaskStatus> {
    match raw {
        "queued" => Some(RunSubtaskStatus::Queued),
        "dispatched" => Some(RunSubtaskStatus::Dispatched),
        "succeeded" => Some(RunSubtaskStatus::Succeeded),
        "failed" => Some(RunSubtaskStatus::Failed),
        "conflicted" => Some(RunSubtaskStatus::Conflicted),
        "unmerged" => Some(RunSubtaskStatus::Unmerged),
        _ => None,
    }
}
