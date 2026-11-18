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

pub struct BudgetReservations {
    max_parallel: u32,
    reserved: u64,
}

impl BudgetReservations {
    pub fn new(max_parallel: u32) -> Self {
        Self {
            max_parallel,
            reserved: 0,
        }
    }

    pub fn try_reserve(&mut self, current_spend: u64, total_run_budget: u64) -> Result<(), String> {
        let subtask_cap = total_run_budget / self.max_parallel as u64;
        if total_run_budget < current_spend + self.reserved + subtask_cap {
            return Err("subtask budget cap reached".to_string());
        }
        self.reserved += subtask_cap;
        Ok(())
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

impl SwarmScheduler {
    pub fn new(max_parallel: u32) -> Self {
        Self {
            max_parallel,
            running_subtasks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn can_dispatch(&self, subtask: &Subtask) -> bool {
        let running = self.running_subtasks.lock().await;
        if running.len() >= self.max_parallel as usize {
            return false;
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

pub fn decompose(plan_text: &str) -> Vec<Subtask> {
    // Deterministic decomposition for tests;
    // real implementation would use the provider to split based on plan_text
    if plan_text.contains("split_2") {
        vec![
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
        ]
    } else {
        vec![Subtask {
            id: Ulid::new(),
            title: "Single Task".to_string(),
            files: vec!["**/*.rs".to_string()],
        }]
    }
}
