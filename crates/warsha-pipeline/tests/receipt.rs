use chrono::Utc;
use std::collections::HashMap;
use ulid::Ulid;
use warsha_core::{ProjectId, Run, RunId, RunStatus, Stage};
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
    };
    let receipt = build_run_receipt(&run, Some(3600));
    assert_eq!(receipt.run_id, run.id);
    assert_eq!(receipt.worktree_path, Some("/tmp/wt".to_string()));
    assert_eq!(receipt.coding_cli_timeout_seconds, Some(3600));
}
