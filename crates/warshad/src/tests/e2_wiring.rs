use super::*;

fn owner() -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(DeviceId::new()));
    ext
}

fn project() -> Project {
    Project {
        id: ProjectId::new(),
        name: "Sessions Project".to_string(),
        description: "Test".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path: None,
        repo_url: None,
    }
}

#[tokio::test]
async fn a_run_turn_uses_the_runs_own_session() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project();
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);

    let first = rpc
        .start_run(&owner(), project.id, "Build a todo app".to_string())
        .await
        .expect("the first run starts");
    let turn = rpc
        .agent_turn_run(&owner(), first.id, "hello".to_string())
        .await
        .expect("the run's turn runs");
    assert_eq!(turn.mode, AgentMode::Plan);
    assert!(
        turn.response.contains("Plan (nothing executed)"),
        "{}",
        turn.response
    );

    let second = rpc
        .start_run(&owner(), project.id, "Second idea".to_string())
        .await
        .expect("the second run starts");
    assert!(rpc.state.agent_sessions.contains(first.id));
    assert!(rpc.state.agent_sessions.contains(second.id));
}

#[tokio::test]
async fn an_unknown_run_has_no_session() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);

    let error = rpc
        .agent_turn_run(&owner(), RunId::new(), "hello".to_string())
        .await
        .expect_err("an unknown run has no session");
    assert!(error.to_string().contains("no agent session"), "{error}");
}

// ---- ENGINE E2b (OD-E2b): the mode RPCs reach one run's own loop.
//
// `agent.approve_mode` / `agent.plan_mode` / `agent.state` take an optional
// `run_id`: present, they operate on that run's loop (the one `agent.turn_run`
// executes on); absent, they are the daemon-wide record they always were. The
// tests below are the two-sided proof — the per-run flow executes, one run's
// approval does not reach another run or the daemon loop, and the old behavior
// without a run id is unchanged.

/// OD-E2b's acceptance test: a run moves Plan → Approved → Agent over the wire,
/// and the command its Plan turn proposed executes on the next turn.
#[tokio::test]
async fn approving_a_run_over_the_wire_executes_its_next_turn() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project();
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let run = rpc
        .start_run(&owner, project.id, "Write the note".to_string())
        .await
        .expect("the run starts");

    // The turn a run starts with plans and executes nothing.
    let input = "write file notes/wire.md: approved over the wire";
    let planned = rpc
        .agent_turn_run(&owner, run.id, input.to_string())
        .await
        .expect("the plan turn runs");
    assert_eq!(planned.mode, AgentMode::Plan);
    assert!(planned.tools.is_empty(), "{:?}", planned.tools);
    let written = temp.path().join("workspace").join("notes").join("wire.md");
    assert!(!written.exists(), "a Plan turn wrote {}", written.display());

    // The owner approves THAT run's loop, over the wire.
    let transition = rpc
        .approve_agent_mode(&owner, Some(run.id))
        .await
        .expect("the run's loop is approved");
    assert_eq!(transition.to, AgentMode::Agent);
    assert!(
        transition.is_owner_approved(),
        "the approval must name the authenticated device: {transition:?}"
    );

    // The read agrees with the write: the same run's state is Agent and carries
    // the switch the approval recorded.
    let run_state = rpc
        .agent_state(&owner, Some(run.id))
        .await
        .expect("the run's state is served");
    assert_eq!(run_state.mode, AgentMode::Agent);
    assert_eq!(
        run_state
            .approvals
            .last()
            .map(|switch| switch.approved_by.as_str()),
        Some(transition.approved_by.as_str())
    );

    // ...and the run's next turn executes; the real file layer wrote the file.
    let executed = rpc
        .agent_turn_run(&owner, run.id, input.to_string())
        .await
        .expect("the approved turn runs");
    assert_eq!(executed.mode, AgentMode::Agent);
    assert_eq!(executed.tools.len(), 1);
    assert!(
        executed.tools[0].success,
        "unexpected tool: {:?}",
        executed.tools[0]
    );
    assert_eq!(
        std::fs::read_to_string(&written).expect("the file is readable"),
        "approved over the wire"
    );

    // The daemon-wide record is not what was approved: it is still in Plan.
    assert_eq!(
        rpc.agent_state(&owner, None)
            .await
            .expect("the daemon-wide record")
            .mode,
        AgentMode::Plan
    );
}

/// The isolation pair: one run's approval is that run's alone.
#[tokio::test]
async fn approving_one_run_leaves_the_other_run_and_the_daemon_loop_in_plan() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project();
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let first = rpc
        .start_run(&owner, project.id, "First".to_string())
        .await
        .expect("the first run starts");
    let second = rpc
        .start_run(&owner, project.id, "Second".to_string())
        .await
        .expect("the second run starts");

    rpc.approve_agent_mode(&owner, Some(first.id))
        .await
        .expect("the first run's loop is approved");

    let first_input = "write file notes/first.md: one";
    let second_input = "write file notes/second.md: two";
    let first_turn = rpc
        .agent_turn_run(&owner, first.id, first_input.to_string())
        .await
        .expect("the approved run turns");
    let second_turn = rpc
        .agent_turn_run(&owner, second.id, second_input.to_string())
        .await
        .expect("the unapproved run turns");

    assert_eq!(first_turn.mode, AgentMode::Agent);
    assert_eq!(first_turn.tools.len(), 1);
    assert!(first_turn.tools[0].success);
    // The run that was not approved is still a plan, and its proposed write never
    // reached the file layer.
    assert_eq!(second_turn.mode, AgentMode::Plan);
    assert!(second_turn.tools.is_empty(), "{:?}", second_turn.tools);
    assert!(
        second_turn.response.contains("Plan (nothing executed)"),
        "{}",
        second_turn.response
    );
    let workspace = temp.path().join("workspace").join("notes");
    assert!(workspace.join("first.md").is_file());
    assert!(
        !workspace.join("second.md").exists(),
        "one run's approval let another run's command run"
    );
    assert_eq!(
        rpc.agent_state(&owner, Some(second.id))
            .await
            .expect("the second run's state")
            .mode,
        AgentMode::Plan
    );
    assert_eq!(
        rpc.agent_state(&owner, None)
            .await
            .expect("the daemon-wide record")
            .mode,
        AgentMode::Plan
    );
}

/// The compatibility pin at the wire: no run id, no change — the daemon-wide loop
/// is the record `agent.approve_mode` moves, exactly as before OD-E2b.
#[tokio::test]
async fn without_a_run_id_the_daemon_loop_is_the_one_that_switches() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project();
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let run = rpc
        .start_run(&owner, project.id, "Untouched".to_string())
        .await
        .expect("the run starts");

    let transition = rpc
        .approve_agent_mode(&owner, None)
        .await
        .expect("the daemon-wide record is approved");
    assert_eq!(transition.to, AgentMode::Agent);
    assert_eq!(
        rpc.agent_state(&owner, None)
            .await
            .expect("the daemon-wide record")
            .mode,
        AgentMode::Agent
    );

    // The run's own loop was not part of that switch: it still plans, and its
    // proposed write does not run.
    assert_eq!(
        rpc.agent_state(&owner, Some(run.id))
            .await
            .expect("the run's state")
            .mode,
        AgentMode::Plan
    );
    let planned = rpc
        .agent_turn_run(&owner, run.id, "write file notes/global.md: no".to_string())
        .await
        .expect("the run's turn runs");
    assert_eq!(planned.mode, AgentMode::Plan);
    assert!(planned.tools.is_empty(), "{:?}", planned.tools);
    assert!(!temp
        .path()
        .join("workspace")
        .join("notes")
        .join("global.md")
        .exists());

    // The read-only direction is unchanged too.
    let back = rpc
        .return_agent_to_plan(&owner, None)
        .await
        .expect("the daemon-wide record returns to plan");
    assert_eq!(back.to, AgentMode::Plan);
}

/// A run can be put back into Plan over the wire, and its next turn executes
/// nothing again.
#[tokio::test]
async fn a_run_returns_to_plan_over_the_wire() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project();
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let run = rpc
        .start_run(&owner, project.id, "Return".to_string())
        .await
        .expect("the run starts");
    // The daemon-wide record goes to Agent as well, so the return below has to be
    // shown to move the run's loop and not that one.
    rpc.approve_agent_mode(&owner, None)
        .await
        .expect("the daemon-wide record is approved");
    rpc.approve_agent_mode(&owner, Some(run.id))
        .await
        .expect("the run's loop is approved");
    assert_eq!(
        rpc.agent_state(&owner, Some(run.id))
            .await
            .expect("the run's state")
            .mode,
        AgentMode::Agent
    );

    let back = rpc
        .return_agent_to_plan(&owner, Some(run.id))
        .await
        .expect("the run's loop returns to plan");
    assert_eq!(back.from, AgentMode::Agent);
    assert_eq!(back.to, AgentMode::Plan);
    assert_eq!(
        rpc.agent_state(&owner, Some(run.id))
            .await
            .expect("the run's state")
            .mode,
        AgentMode::Plan
    );
    assert_eq!(
        rpc.agent_state(&owner, None)
            .await
            .expect("the daemon-wide record")
            .mode,
        AgentMode::Agent,
        "a run's return to plan moved the daemon-wide record"
    );

    let planned = rpc
        .agent_turn_run(&owner, run.id, "write file notes/back.md: no".to_string())
        .await
        .expect("the run's turn runs");
    assert_eq!(planned.mode, AgentMode::Plan);
    assert!(planned.tools.is_empty(), "{:?}", planned.tools);
    assert!(!temp
        .path()
        .join("workspace")
        .join("notes")
        .join("back.md")
        .exists());
}

/// An unknown run id is a clean refusal that names the run, on all three RPCs.
#[tokio::test]
async fn an_unknown_run_is_refused_by_the_run_scoped_mode_rpcs() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();
    let unknown = RunId::new();
    let named = unknown.0.to_string();

    let refusals = [
        rpc.approve_agent_mode(&owner, Some(unknown))
            .await
            .expect_err("an unknown run is not approved"),
        rpc.return_agent_to_plan(&owner, Some(unknown))
            .await
            .expect_err("an unknown run is not returned to plan"),
        rpc.agent_state(&owner, Some(unknown))
            .await
            .expect_err("an unknown run has no state"),
    ];
    for error in refusals {
        let message = error.to_string();
        assert!(message.contains("no agent session"), "{message}");
        assert!(
            message.contains(&named),
            "the error did not name {named}: {message}"
        );
    }
}
