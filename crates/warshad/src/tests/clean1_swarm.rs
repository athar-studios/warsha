//! CLEAN-1: a real daemon run materializes four swarm files at peak concurrency 4.
//!
//! The walk is the desktop order (`projects.create` → `runs.start` → `budget.set`)
//! plus `swarm.project.set` before Code. Intake is the background walk `runs.start`
//! already spawns; this test never calls `runs.advance` to skip Idea. Every role
//! is routed to the in-process fake. The coding backend is the real builtin
//! backend with the materialize fixture on, not `SwarmProbe`.

use super::*;
use futures::FutureExt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use warsha_backends::{reset_fixture_materialize_peak, BuiltinBackend, CODING_BACKEND_FIXTURE_ENV};
use warsha_core::{Role, RoleRouting, RoutingTarget, RunSubtaskStatus, Stage};
use warsha_providers::{FAKE_MODEL_ID, FAKE_PROVIDER_ID};

const EXPECTED_FILES: [&str; 4] = [
    "src/scaffold.rs",
    "src/domain.rs",
    "src/engine.rs",
    "src/provider.rs",
];

fn route_every_role_to_fake() -> ProviderRouter {
    let mut router = ProviderRouter::new();
    for role in Role::all() {
        router.set_role_routing(RoleRouting {
            role: *role,
            targets: vec![RoutingTarget {
                provider_id: FAKE_PROVIDER_ID.to_string(),
                model_id: FAKE_MODEL_ID.to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    router
}

fn git_show(worktree: &std::path::Path, spec: &str) -> String {
    let output = std::process::Command::new("git")
        .args(["show", spec])
        .current_dir(worktree)
        .output()
        .expect("git show runs");
    assert!(
        output.status.success(),
        "git show {spec} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("git show is utf-8")
}

#[tokio::test]
async fn clean1_swarm_four_lanes_materialize_real_files() {
    let temp = crate::test_util::fresh_tempdir();
    // Process-global on purpose: the builtin backend reads it at execute time,
    // which is the same switch a daemon started with the env would see. Restored
    // before the test returns so a later test in this process keeps the no-write path.
    let previous = std::env::var(CODING_BACKEND_FIXTURE_ENV).ok();
    std::env::set_var(CODING_BACKEND_FIXTURE_ENV, "materialize");
    let result = std::panic::AssertUnwindSafe(run_clean1(temp.path()))
        .catch_unwind()
        .await;
    match previous {
        Some(value) => std::env::set_var(CODING_BACKEND_FIXTURE_ENV, value),
        None => std::env::remove_var(CODING_BACKEND_FIXTURE_ENV),
    }
    match result {
        Ok(Ok(())) => {}
        Ok(Err(message)) => panic!("{message}"),
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

async fn run_clean1(data_dir: &std::path::Path) -> std::result::Result<(), String> {
    let (state, _store) = test_state_with_router(data_dir, route_every_role_to_fake()).await;
    let registry = state.pipeline.backend_registry();
    registry.register(std::sync::Arc::new(BuiltinBackend));
    registry.set_default_backend(Some("builtin".to_string()));

    let rpc = WarshaRpc::new(state.clone());
    let ext = owner_ext();

    let project = rpc
        .create_project(
            &ext,
            "clean1".to_string(),
            "four-lane swarm".to_string(),
            "en".to_string(),
            None,
            None,
            None,
        )
        .await
        .map_err(|err| err.to_string())?;

    rpc.set_swarm_settings(&ext, project.id, true, Some(4))
        .await
        .map_err(|err| err.to_string())?;

    let run = rpc
        .start_run(
            &ext,
            project.id,
            "Build a tiny library with four disjoint modules".to_string(),
            None,
            None,
            Some(50_000),
        )
        .await
        .map_err(|err| err.to_string())?;

    rpc.set_budget(&ext, project.id, 50_000)
        .await
        .map_err(|err| err.to_string())?;

    reset_fixture_materialize_peak();
    let peak = std::sync::Arc::new(AtomicUsize::new(0));
    let peak_poll = peak.clone();
    let store_poll = state.store.clone();
    let run_id = run.id;
    let poller = tokio::spawn(async move {
        for _ in 0..400 {
            let rows = store_poll
                .list_run_subtasks(run_id)
                .await
                .unwrap_or_default();
            let in_flight = rows
                .iter()
                .filter(|row| row.status == RunSubtaskStatus::Dispatched)
                .count();
            peak_poll.fetch_max(in_flight, Ordering::SeqCst);
            if rows.len() == EXPECTED_FILES.len()
                && rows
                    .iter()
                    .all(|row| row.status == RunSubtaskStatus::Succeeded)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    });

    let mut current = run;
    for _ in 0..8 {
        let at_gate = tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                let latest = state
                    .store
                    .get_run(run_id)
                    .await
                    .map_err(|err| err.to_string())?;
                if latest.status != warsha_core::RunStatus::Running
                    || latest.current_stage.is_gate()
                {
                    return Ok(latest);
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .map_err(|_| "timed out waiting for a gate".to_string())?
        .map_err(|err: String| err)?;

        current = at_gate;
        if current.current_stage == Stage::Code
            || matches!(
                current.status,
                warsha_core::RunStatus::Failed
                    | warsha_core::RunStatus::Paused
                    | warsha_core::RunStatus::Cancelled
            )
        {
            break;
        }
        if !current.current_stage.is_gate() {
            return Err(format!(
                "run stopped at {:?} ({:?}) before a gate",
                current.current_stage, current.status
            ));
        }
        // Approving Gate A and later gates, then walking forward, is the normal
        // path. Idea already ran inside the task `runs.start` spawned.
        rpc.approve_gate(&ext, run_id, current.current_stage, None)
            .await
            .map_err(|err| err.to_string())?;
        current = rpc
            .advance_run(&ext, run_id)
            .await
            .map_err(|err| err.to_string())?;
        if current.current_stage == Stage::ReviewQaSecurity
            || current
                .artifacts
                .get("code")
                .is_some_and(|artifact| artifact.content.contains("Swarm run of"))
        {
            break;
        }
    }

    let _ = tokio::time::timeout(Duration::from_secs(30), poller).await;

    if current.status != warsha_core::RunStatus::Running
        && current.status != warsha_core::RunStatus::Completed
    {
        return Err(format!(
            "run ended {:?} at {:?}",
            current.status, current.current_stage
        ));
    }

    let subtasks = rpc
        .list_run_subtasks(&ext, run_id)
        .await
        .map_err(|err| err.to_string())?;
    if subtasks.len() != EXPECTED_FILES.len() {
        let titles: Vec<String> = subtasks
            .iter()
            .map(|row| format!("{} files={:?}", row.title, row.files))
            .collect();
        return Err(format!(
            "expected {} subtasks, got {}: {titles:?}",
            EXPECTED_FILES.len(),
            subtasks.len()
        ));
    }
    if !subtasks
        .iter()
        .all(|row| row.status == RunSubtaskStatus::Succeeded)
    {
        return Err(format!("subtasks not all succeeded: {subtasks:?}"));
    }
    let observed = peak
        .load(Ordering::SeqCst)
        .max(warsha_backends::fixture_materialize_peak());
    if observed != EXPECTED_FILES.len() {
        return Err(format!(
            "peak concurrent subtasks was {observed} (store {}, fixture {}), want {}",
            peak.load(Ordering::SeqCst),
            warsha_backends::fixture_materialize_peak(),
            EXPECTED_FILES.len()
        ));
    }

    let worktree = current
        .worktree_path
        .as_deref()
        .ok_or_else(|| "run has no worktree".to_string())?;
    let worktree = std::path::PathBuf::from(worktree);
    let branch = format!("warsha/run-{}", run_id.0);
    for relative in EXPECTED_FILES {
        let body = git_show(&worktree, &format!("{branch}:{relative}"));
        if body.trim().is_empty() {
            return Err(format!("{relative} is empty on {branch}"));
        }
        if !body.contains(&format!("clean1:{relative}")) {
            return Err(format!(
                "{relative} was not written by the fixture backend:\n{body}"
            ));
        }
    }
    Ok(())
}
