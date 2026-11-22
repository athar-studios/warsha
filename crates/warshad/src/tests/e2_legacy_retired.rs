#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use super::*;

fn owner() -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(DeviceId::new()));
    ext
}

fn project() -> Project {
    Project {
        id: ProjectId::new(),
        name: "Retired Loop Project".to_string(),
        description: "Test".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path: None,
        repo_url: None,
        ..Default::default()
    }
}

#[tokio::test]
async fn agent_turn_refuses_with_the_migration_message() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);

    let error = rpc
        .agent_turn(&owner(), "hello".to_string())
        .await
        .expect_err("the retired turn refuses");
    let message = error.to_string();
    assert!(message.contains("agent.turn is retired"), "{message}");
    // The refusal names what to use instead: a run's own loop.
    assert!(message.contains("agent.turn_run"), "{message}");
    // `authorize` ran first and its row still admits the owner, so what a caller
    // receives is the migration message and not a policy refusal.
    assert_ne!(
        error.code(),
        auth::rpc_codes::FORBIDDEN,
        "the refusal must be the migration message, not a policy error: {message}"
    );
}

#[tokio::test]
async fn agent_turn_still_needs_an_authenticated_owner() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);

    // No actor at all: the policy row refuses before the retirement message, which
    // is what shows the row is still the gate it was and not a leftover.
    let error = rpc
        .agent_turn(&RpcExtensions::new(), "hello".to_string())
        .await
        .expect_err("an unauthenticated session is refused");
    assert_eq!(error.code(), auth::rpc_codes::UNAUTHENTICATED, "{error}");
    assert!(!error.to_string().contains("is retired"), "{error}");
}

#[tokio::test]
async fn the_per_run_method_still_runs_a_turn() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project();
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);

    let run = rpc
        .start_run(
            &owner(),
            project.id,
            "Build a todo app".to_string(),
            None,
            None,
        )
        .await
        .expect("the run starts");
    let turn = rpc
        .agent_turn_run(&owner(), run.id, "hello".to_string())
        .await
        .expect("the run's turn runs");
    assert_eq!(turn.mode, AgentMode::Plan);
    assert!(
        turn.response.contains("Plan (nothing executed)"),
        "{}",
        turn.response
    );
}
