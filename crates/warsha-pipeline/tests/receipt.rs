#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    unused_crate_dependencies
)]

use chrono::Utc;
use std::collections::HashMap;
use ulid::Ulid;
use warsha_core::{ApprovalMode, Confinement, ProjectId, Run, RunId, RunMode, RunStatus, Stage};
use warsha_pipeline::receipt::build_run_receipt;

#[test]
fn test_run_receipt_builder() {
    let run = Run {
        id: RunId(Ulid::new()),
        project_id: ProjectId::new(),
        current_stage: Stage::Code,
        gate_states: HashMap::new(),
        artifacts: HashMap::new(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        status: RunStatus::Running,
        budget_cents: Some(100),
        spent_cents: 10,
        worktree_path: Some("/tmp/wt".to_string()),
        worktree_branch: Some("warsha/run-1".to_string()),
        confinement: Some(Confinement::WorkspaceWrite),
        run_mode: warsha_core::RunMode::Agent,
    };
    let receipt = build_run_receipt(
        &run,
        Some(3600),
        Some(Confinement::WorkspaceWrite),
        Some(ApprovalMode::AskForRisky),
    );
    assert_eq!(receipt.run_id, run.id);
    assert_eq!(receipt.worktree_path, Some("/tmp/wt".to_string()));
    assert_eq!(receipt.coding_cli_timeout_seconds, Some(3600));
    assert_eq!(
        receipt.effective_confinement,
        Some(Confinement::WorkspaceWrite)
    );
    assert_eq!(
        receipt.effective_approval_mode,
        Some(ApprovalMode::AskForRisky)
    );
    // D4: an agent run carries its mode and no plan approval.
    assert_eq!(receipt.run_mode, RunMode::Agent);
    assert_eq!(receipt.plan_approved_at, None);

    // D4: a plan run approved at GateB records the plan-approved-at on its receipt.
    let mut plan_run = run.clone();
    plan_run.run_mode = RunMode::Plan;
    plan_run.gate_states.insert(
        Stage::GateB,
        warsha_core::GateState::Approved {
            by: warsha_core::DeviceId::new(),
            at: Utc::now(),
        },
    );
    let plan_receipt = build_run_receipt(
        &plan_run,
        Some(3600),
        Some(Confinement::WorkspaceWrite),
        Some(ApprovalMode::AskForRisky),
    );
    assert_eq!(plan_receipt.run_mode, RunMode::Plan);
    assert!(plan_receipt.plan_approved_at.is_some());
}
