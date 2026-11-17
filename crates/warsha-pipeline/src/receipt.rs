use serde::{Deserialize, Serialize};
use warsha_core::{ApprovalMode, Confinement, ProjectId, Run, RunId, RunStatus, Stage};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunReceipt {
    pub run_id: RunId,
    pub project_id: ProjectId,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub coding_cli_timeout_seconds: Option<u64>,
    pub status: RunStatus,
    pub spent_cents: u64,
    pub budget_cents: Option<u64>,
    pub current_stage: Stage,
    pub effective_confinement: Option<Confinement>,
    pub effective_approval_mode: Option<ApprovalMode>,
}

pub fn build_run_receipt(
    run: &Run,
    coding_cli_timeout_seconds: Option<u64>,
    effective_confinement: Option<Confinement>,
    effective_approval_mode: Option<ApprovalMode>,
) -> RunReceipt {
    RunReceipt {
        run_id: run.id,
        project_id: run.project_id,
        worktree_path: run.worktree_path.clone(),
        worktree_branch: run.worktree_branch.clone(),
        coding_cli_timeout_seconds,
        status: run.status,
        spent_cents: run.spent_cents,
        budget_cents: run.budget_cents,
        current_stage: run.current_stage,
        effective_confinement,
        effective_approval_mode,
    }
}
