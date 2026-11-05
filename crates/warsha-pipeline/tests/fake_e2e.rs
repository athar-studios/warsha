//! End-to-end deterministic pipeline runs driven by the pre-registered fake
//! provider — with zero manual `RoleRouting` configured.
//!
//! These tests pin the W5 contract:
//!
//! - A run started with an empty [`ProviderRouter`] walks `start_run` -> Gate A ->
//!   Gate B -> Gate C -> Gate D -> Feedback (`Completed`), because every unrouted
//!   stage role falls through to the deterministic [`FakeProvider`].
//! - A role that IS routed still goes through `chat_with_fallback` (the
//!   `MockProvider` path the `warshad` e2e tests rely on).
//! - `followup_run` and `cancel_run` record their answers and endings in the run,
//!   the store and the event log.
//!
//! Everything here is offline and reproducible: the fake provider never opens a
//! socket, and the suite never mutates the process environment.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use tempfile::TempDir;
use tokio::sync::RwLock;
use warsha_core::{
    DeviceId, EventKind, GateState, Project, ProjectId, Role, RoleRouting, RoutingTarget,
    RunStatus, Stage,
};
use warsha_pipeline::PipelineEngine;
use warsha_providers::{
    ChatProvider, EnvLlmConfig, FakeProvider, MockProvider, ProviderRouter, FAKE_MODEL_ID,
    FAKE_PROVIDER_ID,
};
use warsha_store::Store;

/// The stage roles a full walk executes, in stage order.
const STAGE_ROLES: [Role; 8] = [
    Role::Researcher,
    Role::PM,
    Role::Designer,
    Role::Architect,
    Role::Coder,
    Role::Reviewer,
    Role::Release,
    Role::Marketer,
];

/// Every role a walk or a follow-up can dispatch through, for the offline guard.
const ALL_DISPATCH_ROLES: [Role; 10] = [
    Role::Intake,
    Role::Researcher,
    Role::PM,
    Role::Designer,
    Role::Architect,
    Role::Coder,
    Role::Reviewer,
    Role::Release,
    Role::Marketer,
    Role::Feedback,
];

/// A fresh temp directory preferring cargo's `CARGO_TARGET_TMPDIR`: the same
/// three-way fallback the daemon tests use
/// (`crates/warshad/tests/events_ws_auth.rs`), because some Windows machines
/// protect `%TEMP%` against even creating a directory there (`Access is denied`).
fn fresh_tempdir() -> TempDir {
    if let Some(base) = std::env::var_os("CARGO_TARGET_TMPDIR") {
        let base = PathBuf::from(base);
        if base.is_dir() {
            if let Ok(dir) = TempDir::new_in(&base) {
                return dir;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(deps) = exe.parent() {
            let base = deps.join("tmp");
            if std::fs::create_dir_all(&base).is_ok() {
                if let Ok(dir) = TempDir::new_in(&base) {
                    return dir;
                }
            }
        }
    }
    TempDir::new().expect("tempdir for the test data")
}

async fn fresh_store() -> (TempDir, Arc<Store>) {
    let dir = fresh_tempdir();
    let store = Store::open_at(dir.path().join("pipeline.db"))
        .await
        .expect("the store opens");
    (dir, Arc::new(store))
}

async fn create_project(store: &Arc<Store>) -> ProjectId {
    let project = Project {
        id: ProjectId::new(),
        name: "clinic-booking".to_string(),
        description: "تطبيق حجز مواعيد لعيادة أسنان".to_string(),
        language: "ar".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path: None,
        repo_url: None,
    };
    store.create_project(&project).await.expect("a project");
    project.id
}

/// Whether the *ambient* environment would steer unrouted stages to a real
/// endpoint: a non-blank `WARSHA_LLM_API_KEY` and no explicit `WARSHA_LLM_PROVIDER=fake`.
fn ambient_env_openai() -> bool {
    let key = EnvLlmConfig::from_env().api_key;
    let forced_fake = std::env::var("WARSHA_LLM_PROVIDER")
        .ok()
        .map(|value| value.trim() == "fake")
        .unwrap_or(false);
    key.is_some() && !forced_fake
}

/// The router under test: an empty [`ProviderRouter`] — no manual routing — so the
/// walk exercises the zero-configuration fake fallthrough.
///
/// One offline guard: if the machine running the suite happens to export
/// `WARSHA_LLM_API_KEY`, the unrouted path would legitimately try `env-openai`
/// over the network, which repository rules forbid in tests. In that case (and
/// only then) every stage role is explicitly routed to the pre-registered `"fake"`
/// adapter, which keeps the assertions about artifact content identical.
fn walk_router() -> Arc<RwLock<ProviderRouter>> {
    let mut router = ProviderRouter::new();
    if ambient_env_openai() {
        for role in ALL_DISPATCH_ROLES {
            router.set_role_routing(RoleRouting {
                role,
                targets: vec![RoutingTarget {
                    provider_id: FAKE_PROVIDER_ID.to_string(),
                    model_id: FAKE_MODEL_ID.to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
        }
    }
    Arc::new(RwLock::new(router))
}

/// Approve `stage` for `run` with a fresh verified device.
async fn approve(engine: &PipelineEngine, run_id: warsha_core::RunId, stage: Stage) {
    engine
        .approve_gate(run_id, stage, DeviceId::new())
        .await
        .unwrap_or_else(|error| panic!("gate {stage:?} approves: {error}"));
}

#[tokio::test]
async fn a_zero_config_run_walks_every_gate_to_feedback_completed() {
    let (_dir, store) = fresh_store().await;
    let providers = walk_router();
    let engine = PipelineEngine::new(store.clone(), providers);
    let project_id = create_project(&store).await;

    let run = engine
        .start_run(project_id, "تطبيق حجز مواعيد لعيادة أسنان")
        .await
        .expect("the run starts");
    assert_eq!(run.current_stage, Stage::Idea);

    // ---- Gate A.
    let run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("to Gate A");
    assert_eq!(run.current_stage, Stage::GateA);
    assert!(matches!(run.gate_states[&Stage::GateA], GateState::Pending));
    approve(&engine, run.id, Stage::GateA).await;

    // ---- Gate B: research and the PRD spec were executed by the fake.
    let run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("to Gate B");
    assert_eq!(run.current_stage, Stage::GateB);
    let research = &run
        .artifacts
        .get("research")
        .expect("research artifact")
        .content;
    let prd = &run.artifacts.get("prd_spec").expect("prd artifact").content;
    assert!(research.starts_with("# Fake Research Report"), "{research}");
    assert!(prd.starts_with("# Fake PRD & Spec"), "{prd}");
    approve(&engine, run.id, Stage::GateB).await;

    // ---- Gate C: design, plan, code and review were executed by the fake.
    let run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("to Gate C");
    assert_eq!(run.current_stage, Stage::GateC);
    for (name, title) in [
        ("design", "# Fake Design Spec"),
        ("plan_tasks", "# Fake Task Plan"),
        ("code", "# Fake Implementation"),
        ("review_qa_security", "# Fake Review, QA & Security Report"),
    ] {
        let content = &run
            .artifacts
            .get(name)
            .unwrap_or_else(|| panic!("{name} artifact"))
            .content;
        assert!(content.starts_with(title), "{name}: {content}");
        assert!(!content.trim().is_empty(), "{name} is empty");
    }
    // Every stage artifact is distinct.
    let contents: Vec<&str> = run
        .artifacts
        .values()
        .map(|artifact| artifact.content.as_str())
        .collect();
    let mut unique = contents.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), contents.len(), "two artifacts are identical");
    approve(&engine, run.id, Stage::GateC).await;

    // ---- Gate D: the release stage was executed by the fake.
    let run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("to Gate D");
    assert_eq!(run.current_stage, Stage::GateD);
    assert!(run.artifacts["release"]
        .content
        .starts_with("# Fake Release Preparation"));
    approve(&engine, run.id, Stage::GateD).await;

    // ---- Feedback completes the run.
    let run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("Feedback completes the run");
    assert_eq!(run.current_stage, Stage::Feedback);
    assert_eq!(run.status, RunStatus::Completed);
    assert!(run.artifacts["launch_drafts"]
        .content
        .starts_with("# Fake Launch Drafts"));
    assert!(
        run.spent_cents > 0,
        "stage calls are metered even against the fake"
    );

    // The completion is persisted, the factory carries the artifacts, and every
    // executed stage left an agent-step event.
    let stored = store.get_run(run.id).await.expect("the run reloads");
    assert_eq!(stored.status, RunStatus::Completed);
    let factory_code = store
        .read_artifact(project_id, "code")
        .await
        .expect("the code artifact is in the factory");
    assert_eq!(factory_code, run.artifacts["code"].content);
    let events = store.get_events(run.id).await.expect("events read back");
    let steps = events
        .iter()
        .filter(|event| event.kind == EventKind::AgentStep)
        .count();
    assert_eq!(steps, 8, "one agent step per executed stage: {steps}");

    // Calling advance_to_next_gate again on the finished run is a no-op that keeps
    // it completed.
    let again = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("the finished run stays finished");
    assert_eq!(again.status, RunStatus::Completed);
    assert_eq!(again.current_stage, Stage::Feedback);
}

#[tokio::test]
async fn a_walk_without_an_approval_stops_at_the_pending_gate() {
    let (_dir, store) = fresh_store().await;
    let engine = PipelineEngine::new(store.clone(), walk_router());
    let project_id = create_project(&store).await;
    let run = engine
        .start_run(project_id, "A walk that waits")
        .await
        .expect("start");

    let at_gate = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("to Gate A");
    assert_eq!(at_gate.current_stage, Stage::GateA);
    // Still pending: the walk reports the gate instead of forcing past it.
    let error = engine
        .advance_stage(at_gate.id)
        .await
        .expect_err("an unapproved gate blocks the way");
    assert!(matches!(
        error,
        warsha_pipeline::PipelineError::GateNotPending(Stage::GateA)
    ));
}

#[tokio::test]
async fn a_routed_role_still_answers_from_its_routed_provider() {
    // The backward-compatibility contract: when a role is routed, the stage goes
    // through `chat_with_fallback` and the routed adapter answers — never the fake.
    let (_dir, store) = fresh_store().await;
    let mut router = ProviderRouter::new();
    let mock = MockProvider::new("mock");
    let mock_calls = mock.call_counter();
    router.register_provider(Box::new(mock));
    for role in STAGE_ROLES {
        router.set_role_routing(RoleRouting {
            role,
            targets: vec![RoutingTarget {
                provider_id: "mock".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    let engine = PipelineEngine::new(store.clone(), Arc::new(RwLock::new(router)));
    let project_id = create_project(&store).await;
    let run = engine
        .start_run(project_id, "Routed walk")
        .await
        .expect("the run starts");

    let run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("to Gate A");
    assert_eq!(run.current_stage, Stage::GateA);
    approve(&engine, run.id, Stage::GateA).await;

    let run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("to Gate B");
    assert_eq!(run.current_stage, Stage::GateB);
    assert_eq!(run.artifacts["research"].content, "Mock response");
    assert_eq!(run.artifacts["prd_spec"].content, "Mock response");
    assert!(
        mock_calls.load(std::sync::atomic::Ordering::SeqCst) >= 2,
        "the routed mock was actually called"
    );
}

#[tokio::test]
async fn followup_run_records_a_deterministic_answer_without_moving_the_stage() {
    let (_dir, store) = fresh_store().await;
    let engine = PipelineEngine::new(store.clone(), walk_router());
    let project_id = create_project(&store).await;
    let run = engine
        .start_run(project_id, "Follow-up target")
        .await
        .expect("the run starts");

    let answered = engine
        .followup_run(run.id, "Add dark mode to the clinic app")
        .await
        .expect("the follow-up is answered");
    assert_eq!(
        answered.current_stage,
        Stage::Idea,
        "the stage did not move"
    );
    let artifact = answered
        .artifacts
        .get("followup")
        .expect("the followup artifact is recorded");
    assert!(
        artifact.content.starts_with("# Fake Follow-up Answer"),
        "{}",
        artifact.content
    );
    assert!(
        artifact.content.contains("add-dark-mode"),
        "{}",
        artifact.content
    );

    // The same prompt answers identically: the reply is a function of the prompt.
    let again = engine
        .followup_run(run.id, "Add dark mode to the clinic app")
        .await
        .expect("the follow-up answers again");
    assert_eq!(
        again.artifacts["followup"].content, artifact.content,
        "the follow-up answer is deterministic"
    );

    // The factory carries it, the event log explains it, and the run is persisted.
    let factory = store
        .read_artifact(project_id, "followup")
        .await
        .expect("the followup reaches the factory");
    assert_eq!(factory, artifact.content);
    let events = store.get_events(run.id).await.expect("events read back");
    let step = events
        .iter()
        .rev()
        .find(|event| event.kind == EventKind::AgentStep && event.payload["action"] == "followup")
        .expect("the follow-up emitted an agent-step event");
    assert_eq!(step.payload["prompt"], "Add dark mode to the clinic app");
    assert_eq!(step.payload["response"], artifact.content);
    let stored = store.get_run(run.id).await.expect("the run reloads");
    assert_eq!(stored.current_stage, Stage::Idea);
    assert!(stored.artifacts.contains_key("followup"));
}

#[tokio::test]
async fn cancel_run_marks_the_run_cancelled_with_its_reason_on_the_log() {
    let (_dir, store) = fresh_store().await;
    let engine = PipelineEngine::new(store.clone(), walk_router());
    let project_id = create_project(&store).await;
    let run = engine
        .start_run(project_id, "A run that gets cancelled")
        .await
        .expect("the run starts");

    let cancelled = engine
        .cancel_run(run.id, Some("owner changed plans".to_string()))
        .await
        .expect("the run cancels");
    assert_eq!(cancelled.status, RunStatus::Cancelled);

    // A reason-less cancel works too, and rewrites the same run.
    let cancelled = engine
        .cancel_run(run.id, None)
        .await
        .expect("a cancel with no reason is still a cancel");
    assert_eq!(cancelled.status, RunStatus::Cancelled);

    let stored = store.get_run(run.id).await.expect("the run reloads");
    assert_eq!(stored.status, RunStatus::Cancelled);

    let events = store.get_events(run.id).await.expect("events read back");
    let cancels: Vec<_> = events
        .iter()
        .filter(|event| {
            event.kind == EventKind::Error && event.payload["action"] == "run_cancelled"
        })
        .collect();
    assert_eq!(cancels.len(), 2, "both cancels are on the log");
    assert_eq!(cancels[0].payload["reason"], "owner changed plans");
    assert!(cancels[1].payload["reason"].is_null());

    // A cancelled run cannot walk on: `advance_stage` refuses it.
    let error = engine
        .advance_stage(run.id)
        .await
        .expect_err("a cancelled run does not advance");
    assert!(
        matches!(error, warsha_pipeline::PipelineError::Other(_)),
        "unexpected error: {error:?}"
    );
}

#[tokio::test]
async fn the_fake_is_registered_on_every_router_by_default() {
    // `"fake"` availability is the contract the pipeline's fallthrough and these
    // tests both stand on.
    let router = ProviderRouter::new();
    let fake = router
        .get_provider(FAKE_PROVIDER_ID)
        .expect("every router carries the fake");
    let models = fake.list_models().await.expect("the fake lists models");
    assert_eq!(models[0].id, FAKE_MODEL_ID);
    // And the concrete type stays usable directly for one-off deterministic calls.
    let response = FakeProvider::new()
        .chat(warsha_providers::ChatRequest {
            model: FAKE_MODEL_ID.to_string(),
            messages: vec![warsha_providers::ChatMessage {
                role: warsha_providers::MessageRole::User,
                content: "deterministic check".to_string(),
            }],
            temperature: None,
            max_tokens: None,
            stream: false,
        })
        .await
        .expect("the fake answers");
    assert_eq!(response.choices.len(), 1);
}
