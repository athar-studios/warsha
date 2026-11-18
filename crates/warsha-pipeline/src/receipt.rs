use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use warsha_core::{ApprovalMode, Confinement, ProjectId, Run, RunId, RunMode, RunStatus, Stage};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FailoverRecord {
    pub from_provider: String,
    pub to_provider: String,
    pub reason: String,
    pub at: DateTime<Utc>,
}

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
    /// D4: the mode this run was launched in (`agent` for every pre-D4 run once
    /// migration 015 backfills them, `plan`/`spec-file` for runs stopped at the
    /// GateB plan-approval gate).
    pub run_mode: RunMode,
    /// D4: when the owner approved the plan at the GateB plan-approval gate of a
    /// `plan`/`spec-file` run. `None` for agent runs and for plans not yet approved.
    #[serde(default)]
    pub plan_approved_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub failovers: Vec<FailoverRecord>,
}

pub fn build_run_receipt(
    run: &Run,
    coding_cli_timeout_seconds: Option<u64>,
    effective_confinement: Option<Confinement>,
    effective_approval_mode: Option<ApprovalMode>,
) -> RunReceipt {
    build_run_receipt_with_failovers(
        run,
        coding_cli_timeout_seconds,
        effective_confinement,
        effective_approval_mode,
        Vec::new(),
    )
}

/// D4: `plan_approved_at` reads the plan-approval decision straight off the run's
/// GateB gate state — the receipt must not depend on the caller remembering to fill it.
fn plan_approved_at_of(run: &Run) -> Option<DateTime<Utc>> {
    match run.gate_states.get(&Stage::GateB) {
        Some(crate::GateState::Approved { at, .. }) => Some(*at),
        _ => None,
    }
}

pub fn build_run_receipt_with_failovers(
    run: &Run,
    coding_cli_timeout_seconds: Option<u64>,
    effective_confinement: Option<Confinement>,
    effective_approval_mode: Option<ApprovalMode>,
    failovers: Vec<FailoverRecord>,
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
        run_mode: run.run_mode,
        plan_approved_at: plan_approved_at_of(run),
        failovers,
    }
}
