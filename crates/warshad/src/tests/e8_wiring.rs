#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use super::*;
use std::process::Command;

/// The address the preview's probe prints. `tests::preview_probe` owns that
/// fixture and its constant is private to the `tests` module, so the same value
/// is spelled here — exactly as the E5 wiring tests do.
const PROBE_URL: &str = "http://127.0.0.1:5199/";

/// What the Gate C test program prints, and what the evidence must carry: the
/// reviewer is shown the measured output, not a claim that a test ran.
const TEST_MARKER: &str = "e8 pilot gate c test probe: ok";

fn owner() -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(DeviceId::new()));
    ext
}

/// A repository with one committed file, which is what `projects.attach` takes
/// and what the run's worktree is created from.
fn git_repo(dir: &std::path::Path) {
    std::fs::write(dir.join("base.txt"), "base").expect("a base file");
    for args in [
        vec!["init", "-q"],
        vec!["config", "user.email", "test@example.com"],
        vec!["config", "user.name", "Test"],
        vec!["add", "."],
        vec!["commit", "-qm", "base"],
    ] {
        let status = Command::new("git")
            .current_dir(dir)
            .args(&args)
            .status()
            .expect("git runs");
        assert!(status.success(), "git {args:?} failed");
    }
}

fn current_exe() -> String {
    std::env::current_exe()
        .expect("the test binary names itself")
        .display()
        .to_string()
}

/// The Gate C test program: one passing test of this binary, selected exactly.
///
/// It stands in for a project's own `cargo test` — the daemon only ever sees a
/// program, its arguments and the measured result, and this is a real program
/// that really exits 0 and really prints [`TEST_MARKER`]. `#[ignore]` keeps it
/// out of a plain `cargo test`; the pilot runs it by name.
#[test]
#[ignore = "run by the E8 pilot as its Gate C test program"]
fn gate_c_test_probe() {
    println!("{TEST_MARKER}");
}

/// The program and arguments the pilot measures at Gate C.
fn test_program() -> (String, Vec<String>) {
    (
        current_exe(),
        vec![
            "--exact".to_string(),
            "e8_wiring::gate_c_test_probe".to_string(),
            "--ignored".to_string(),
            "--nocapture".to_string(),
        ],
    )
}

/// The command line that starts one `tests::preview_probe` dev server — the
/// probe the E5 preview tests run, named from this module.
fn preview_line() -> String {
    format!(
        "{} --exact tests::preview_probe --ignored --nocapture",
        current_exe()
    )
}

/// The daemon state the pilot runs on. The test binary is the only allow-listed
/// program because it is both the Gate C test program and the preview server;
/// everything else is the state a real daemon would build, with the mock
/// provider registered.
async fn pilot_state(data_dir: &std::path::Path) -> (Arc<DaemonState>, Arc<Store>) {
    let program = current_exe();
    crate::tests::test_state_with_seams(
        data_dir,
        move |config| config.allowed_commands = vec![program],
        None,
        None,
        None,
    )
    .await
}

/// Route the seven roles the walk to Gate C meets to the daemon's own mock
/// provider, through `roles.set` — the RPC an owner uses, so the walk is not
/// reading a table a test wrote behind the daemon's back.
async fn route_the_walk_to_the_mock(rpc: &WarshaRpc, owner: &RpcExtensions) {
    for role in [
        Role::Intake,
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Coder,
        Role::Reviewer,
    ] {
        let name = serde_json::to_value(role)
            .expect("a role serialises")
            .as_str()
            .expect("a role serialises as a name")
            .to_string();
        rpc.set_role(
            owner,
            RoleRoutingConfig {
                role: name,
                targets: vec![RoutingTargetConfig {
                    provider_id: MOCK_PROVIDER_ID.to_string(),
                    model_id: "mock-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
                daily_spend_cap_cents: None,
            },
        )
        .await
        .expect("the role routes to the mock provider");
    }
}

/// ENGINE E8's acceptance test: the loop a client drives, once, on the mock
/// provider — `projects.create` → `projects.attach` → `runs.start` → the run's
/// own agent turn → `runs.advance`/`gates.approve` to Gate C → `gates.evidence`
/// → the Gate C decision.
#[tokio::test]
#[ignore = "pilot: spawns child processes; run with `cargo test -p warshad -- --ignored pilot`"]
async fn pilot_attaches_a_repository_runs_decides_gate_c_and_collects_evidence() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo dir");
    git_repo(repo.path());
    let (state, _store) = pilot_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    // 1. `projects.create` → `projects.attach`: the entry point is the RPC a
    //    client calls, not a row written behind the daemon's back.
    let project = rpc
        .create_project(
            &owner,
            "Pilot Project".to_string(),
            "Pilot".to_string(),
            "en".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("the project is created");
    let auto_repo = temp
        .path()
        .join("projects")
        .join(project.id.to_string())
        .join("repo");
    assert_eq!(
        project.repo_path.as_deref(),
        Some(auto_repo.to_str().unwrap()),
        "a greenfield project starts with an auto-initialized repository"
    );
    let repo_path = repo.path().display().to_string();
    let attached = rpc
        .attach_project(&owner, project.id, repo_path.clone())
        .await
        .expect("the repository attaches");
    assert_eq!(attached.repo_path.as_deref(), Some(repo_path.as_str()));

    // 2. Every role the walk meets answers from the daemon's own mock provider.
    route_the_walk_to_the_mock(&rpc, &owner).await;

    // 3. `runs.start`: the run gets its own worktree of that repository.
    let run = rpc
        .start_run(
            &owner,
            project.id,
            "Build a todo app".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("the run starts");
    let worktree = rpc
        .run_worktree(&owner, run.id)
        .await
        .expect("the worktree is reported")
        .expect("the run has a worktree");
    assert!(worktree.path.is_dir(), "the run's worktree is a directory");
    assert_eq!(
        std::fs::read_to_string(worktree.path.join("base.txt")).expect("the checked-out file"),
        "base"
    );

    // 4. The run's own agent loop edits the run's worktree: Plan proposes and
    //    executes nothing, the owner approves that run, then the read the
    //    read-before-write rule needs and the write itself both run.
    let edit = "write file base.txt: built by the pilot";
    let planned = rpc
        .agent_turn_run(&owner, run.id, edit.to_string())
        .await
        .expect("the plan turn runs");
    assert_eq!(planned.mode, AgentMode::Plan);
    assert!(
        planned.tools.is_empty(),
        "a Plan turn executed {:?}",
        planned.tools
    );
    assert_eq!(
        std::fs::read_to_string(worktree.path.join("base.txt")).expect("the file"),
        "base",
        "a Plan turn changed the worktree"
    );

    rpc.approve_agent_mode(&owner, Some(run.id))
        .await
        .expect("the run's loop is approved");
    let read = rpc
        .agent_turn_run(&owner, run.id, "read file base.txt".to_string())
        .await
        .expect("the read turn runs");
    assert_eq!(read.mode, AgentMode::Agent);
    assert!(
        read.tools.iter().all(|tool| tool.success),
        "the read did not run: {:?}",
        read.tools
    );
    let written = rpc
        .agent_turn_run(&owner, run.id, edit.to_string())
        .await
        .expect("the approved write runs");
    assert_eq!(written.mode, AgentMode::Agent);
    assert!(
        written.tools.len() == 1 && written.tools[0].success,
        "the write did not run: {:?}",
        written.tools
    );
    assert_eq!(
        std::fs::read_to_string(worktree.path.join("base.txt")).expect("the file"),
        "built by the pilot"
    );

    // 5. The pipeline walks to Gate C the way a client drives it: advance to the
    //    next undecided gate, decide it, advance again.
    let at_gate_a = rpc
        .advance_run(&owner, run.id)
        .await
        .expect("the run reaches Gate A");
    assert_eq!(at_gate_a.current_stage, Stage::GateA);
    rpc.approve_gate(&owner, run.id, Stage::GateA, None)
        .await
        .expect("Gate A is approved");

    let at_gate_b = rpc
        .advance_run(&owner, run.id)
        .await
        .expect("the run reaches Gate B");
    assert_eq!(at_gate_b.current_stage, Stage::GateB);
    // The routed mock answered the stages before this gate, not a fake fallback.
    assert_eq!(
        at_gate_b.artifacts["research"].content, "Mock response",
        "the Research stage was not answered by the mock provider"
    );
    rpc.approve_gate(&owner, run.id, Stage::GateB, None)
        .await
        .expect("Gate B is approved");

    let at_gate_c = rpc
        .advance_run(&owner, run.id)
        .await
        .expect("the run reaches Gate C");
    assert_eq!(at_gate_c.current_stage, Stage::GateC);
    for stage in ["design", "plan_tasks", "code", "review_qa_security"] {
        assert_eq!(
            at_gate_c.artifacts[stage].content, "Mock response",
            "the {stage} stage was not answered by the mock provider"
        );
    }

    // 6. The preview the panel starts, then the evidence a Gate C reviewer reads.
    let preview = rpc
        .start_preview(&owner, project.id.to_string(), preview_line())
        .await
        .expect("the preview starts");
    assert_eq!(preview.url.as_deref(), Some(PROBE_URL));

    let (program, args) = test_program();
    let evidence = rpc
        .gate_evidence(&owner, run.id, program.clone(), args.clone())
        .await
        .expect("the evidence is collected");

    // The diff is the agent's change in the run's worktree...
    assert!(
        evidence.diff.contains("base.txt"),
        "the diff does not name the file the agent changed: {}",
        evidence.diff
    );
    assert!(
        evidence.diff.contains("built by the pilot"),
        "the diff does not carry the agent's content: {}",
        evidence.diff
    );
    assert!(
        evidence.files_changed.iter().any(|path| path == "base.txt"),
        "the changed paths do not name base.txt: {:?}",
        evidence.files_changed
    );
    // ...the measured test run is passing, and it is the program the caller named...
    assert!(evidence.tests.success, "{:?}", evidence.tests);
    assert_eq!(evidence.tests.program, program);
    assert_eq!(evidence.tests.args, args);
    assert_eq!(evidence.tests.exit_code, Some(0));
    assert!(
        evidence.tests.stdout.contains(TEST_MARKER),
        "the measured output is not the test's: {}",
        evidence.tests.stdout
    );
    // ...and the preview that is already up is part of it.
    let running = evidence
        .preview
        .as_ref()
        .expect("the running preview is part of the evidence");
    assert_eq!(running.url.as_deref(), Some(PROBE_URL));
    assert_eq!(running.status, ProcessStatus::Running);
    assert_eq!(running.project_id, project.id.to_string());
    assert_eq!(running.process_id, preview.process_id);

    // 7. The Gate C decision, over the wire. The run's ledger, the queue read
    //    and the run's event log all have to agree that it was decided.
    let decided = rpc
        .approve_gate(&owner, run.id, Stage::GateC, None)
        .await
        .expect("Gate C is approved");
    assert_eq!(
        decided.current_stage,
        Stage::GateC,
        "a decision must not move the run off the gate it decides"
    );
    assert!(
        matches!(
            decided.gate_states.get(&Stage::GateC),
            Some(GateState::Approved { .. })
        ),
        "the deciding run carries no approval: {:?}",
        decided.gate_states
    );

    let gates = rpc
        .list_gates(&owner, run.id, None)
        .await
        .expect("the queue is served");
    let gate_c = gates
        .iter()
        .find(|gate| gate.stage == Stage::GateC)
        .expect("Gate C is in the queue");
    assert!(
        matches!(gate_c.state, GateSummaryState::Approved { .. }),
        "the queue does not report the decision: {gate_c:?}"
    );

    let events = rpc
        .get_events(&owner, run.id)
        .await
        .expect("the run's events are served");
    let decision = events
        .iter()
        .find(|event| event.stage == Stage::GateC && event.kind == EventKind::GateDecision)
        .expect("the Gate C decision is on the run's log");
    assert_eq!(decision.payload["decision"], "approved");
    assert!(
        decision.payload["artifacts_sha256"].is_string(),
        "the decision does not name what it approved: {}",
        decision.payload
    );

    // 8. The evidence outlives the decision: the reviewer's record is the same
    //    one after the gate was decided, and the decision itself moves nothing
    //    the evidence measured.
    let after = rpc
        .gate_evidence(&owner, run.id, program, args)
        .await
        .expect("the evidence is still collectible after the decision");
    assert_eq!(after.diff, evidence.diff);
    assert_eq!(after.files_changed, evidence.files_changed);
    assert!(after.tests.success);
    assert_eq!(
        after
            .preview
            .as_ref()
            .expect("the preview is still up")
            .url
            .as_deref(),
        Some(PROBE_URL)
    );

    rpc.stop_preview(&owner, project.id.to_string())
        .await
        .expect("the preview stops");
}
