//! End-to-end test: a written request becomes a working, tested, built binary.
//!
//! The flow is the one a real project takes, with a cheap model in place of a
//! cloud one: the daemon's RPC layer creates the project and starts the run, the
//! agent asks its clarifying question and the owner answers it, the plan is shown
//! in Plan mode and approved into Agent mode, the run walks the pipeline stages
//! with the mock provider answering every one, the planned Rust project lands in a
//! temporary directory, and `cargo test`, `cargo build` and the built binary are
//! what decide whether the result is green.
//!
//! What the test does not pretend:
//!
//! - **No network, no key, no spend.** The only provider on the router is
//!   [`MockProvider`]. It is also the cheap model: the router prices a stage call
//!   at a fraction of a cent, so a run to the code stage costs cents.
//! - **The mock provider answers every stage with one sentence.** The intake
//!   question, the plan, the code and the tests are the scripted answers below —
//!   the canned LLM responses the flow needs. The three answers that carry real
//!   content — the plan, the code and the test — are recorded through the same
//!   [`PipelineEngine::upsert_artifact`] call an agent's output would use, and the
//!   test asserts the mock's sentence was there first, so the stage really did
//!   reach the provider.
//! - **`cargo` runs as a real subprocess** in the generated project (offline, no
//!   dependencies), so "tests green" and "the binary prints the greeting" mean
//!   exactly what they say.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use serde_json::json;
use tempfile::tempdir;
use tokio::sync::{broadcast, RwLock};
use warsha_backends::BackendFactory;
use warsha_core::{
    Artifact, DeviceId, Event, EventKind, GateState, Role, RoleRouting, RoutingTarget, Stage,
};
use warsha_pipeline::{
    AgentLoop, AgentMode, AskUserRequest, InMemoryCrashReportStore, InMemoryMcpManager,
    InMemoryProcessManager, InMemoryStoreReviewStore, LivePreviewManager, McpManager,
    PipelineEngine, ProcessManager,
};
use warsha_providers::{MockProvider, ProviderRouter};
use warsha_remote::{DeviceIdentity, DeviceRegistry};
use warsha_store::Store;
use warshad::{DaemonConfig, DaemonState, WarshaApiServer, WarshaRpc};

/// The written request the project starts from.
const HELLO_REQUEST: &str = "Build a hello-world Rust CLI that prints 'Hello, {name}!'";

/// The package (and library) name of the generated project.
const PACKAGE_NAME: &str = "hello-cli";

/// Who the greeting is for: the owner's answer to the clarifying question, and the
/// argument the built binary is run with.
const GREETING_NAME: &str = "Ada";

/// The owner who approves Agent mode and the gates.
const OWNER: &str = "owner";

/// The provider id and model every stage role routes to.
const MOCK_PROVIDER: &str = "mock";
const MOCK_MODEL: &str = "mock-model";

/// Exactly what `warsha_providers::MockProvider` answers, which the test asserts a
/// stage artifact carried before the scripted answer replaced it.
const MOCK_RESPONSE: &str = "Mock response";

/// The intake agent's clarifying question.
///
/// A `MockProvider` answers one fixed sentence, so the question a real intake model
/// would ask is scripted here and queued on the agent loop's `ask_user` store; the
/// test is the owner who answers it.
const CLARIFYING_QUESTION: &str =
    "Which name should the greeting print when the CLI is given no argument?";

/// The architect's answer: the plan, one numbered file per step.
const SCRIPTED_PLAN: &str = r#"# Plan — hello-world Rust CLI

1. Cargo.toml
2. src/lib.rs
3. src/main.rs
4. tests/greeting.rs

Step 3 is the entry point, and step 4 is the reviewer's test, so `cargo test`
decides whether the plan was executed correctly.
"#;

/// The coder's answer: the package manifest and the two sources, as file blocks.
const SCRIPTED_CODE: &str = r#"--- FILE: Cargo.toml ---
[package]
name = "hello-cli"
version = "0.1.0"
edition = "2021"

[dependencies]
--- FILE: src/lib.rs ---
//! Greeting logic for the hello-world CLI.

/// Greets `name` the way the CLI prints it.
pub fn greeting(name: &str) -> String {
    format!("Hello, {name}!")
}

#[cfg(test)]
mod tests {
    use super::greeting;

    #[test]
    fn greets_the_given_name() {
        assert_eq!(greeting("Ada"), "Hello, Ada!");
    }
}
--- FILE: src/main.rs ---
//! Prints `Hello, {name}!` for the name it is given, or for `world`.

fn main() {
    let name = std::env::args().nth(1).unwrap_or_else(|| "world".to_string());
    println!("{}", hello_cli::greeting(&name));
}
"#;

/// The reviewer's answer: the generated project's integration test.
const SCRIPTED_TESTS: &str = r#"--- FILE: tests/greeting.rs ---
//! Integration test for the generated CLI library.

use hello_cli::greeting;

#[test]
fn greets_the_name_it_is_given() {
    assert_eq!(greeting("Ada"), "Hello, Ada!");
}
"#;

#[tokio::test]
async fn e2e_request_to_artifact() {
    // ---- 1. Setup: a temporary tree, a store, and the daemon state over it.
    let temp = tempdir().expect("a temporary directory");
    let data_dir = temp.path().join("data");
    let project_dir = temp.path().join(PACKAGE_NAME);
    let state = daemon_state(&data_dir).await;
    let rpc = WarshaRpc::new(state.clone());

    // ---- 2. The written request becomes a project and a run.
    let project = rpc
        .create_project(
            PACKAGE_NAME.to_string(),
            HELLO_REQUEST.to_string(),
            "en".to_string(),
        )
        .await
        .expect("projects.create succeeds");
    assert_eq!(project.name, PACKAGE_NAME);
    let run = rpc
        .start_run(project.id, HELLO_REQUEST.to_string())
        .await
        .expect("runs.start succeeds");
    assert_eq!(run.current_stage, Stage::Idea);
    assert_eq!(
        run.artifacts
            .get("idea")
            .expect("the run records the idea")
            .content,
        HELLO_REQUEST
    );
    // The run's append-only log is written before any gate decision, so it is
    // readable here: one `stage_started` event carrying the request.
    let started = rpc
        .get_events(run.id)
        .await
        .expect("the run's events are readable");
    assert_eq!(started.len(), 1, "unexpected events: {started:?}");
    assert_eq!(started[0].kind, EventKind::StageStarted);
    assert_eq!(started[0].stage, Stage::Idea);
    assert_eq!(started[0].payload["idea"], json!(HELLO_REQUEST));

    // ---- 3. The agent asks its clarifying question; the owner answers it.
    {
        let mut agent = state.agent_loop.write().await;
        agent
            .ask_queue
            .enqueue(AskUserRequest::new("q1", CLARIFYING_QUESTION, true))
            .expect("the question queues");
        assert!(
            agent.ask_queue.blocks_run(),
            "a blocking question stops the run until it is answered"
        );
    }
    {
        let mut agent = state.agent_loop.write().await;
        let answered = agent
            .ask_queue
            .answer("q1", GREETING_NAME)
            .expect("an unanswered question takes an answer");
        assert_eq!(answered.question, CLARIFYING_QUESTION);
        assert_eq!(answered.answer.as_deref(), Some(GREETING_NAME));
        assert!(!agent.ask_queue.blocks_run(), "the run may continue now");
        assert_eq!(agent.ask_queue.answered_count(), 1);
    }

    // ---- 4. Plan mode proposes, the owner approves, Agent mode may edit.
    let plan = {
        let mut agent = state.agent_loop.write().await;
        agent.run_turn(HELLO_REQUEST, &[])
    };
    assert_eq!(plan.mode, AgentMode::Plan);
    assert!(
        plan.response.starts_with("Plan (nothing executed):"),
        "unexpected plan: {}",
        plan.response
    );
    assert!(
        !state.agent_loop.read().await.mode_manager.can_edit(),
        "Plan mode may not edit"
    );
    let approval = {
        let mut agent = state.agent_loop.write().await;
        agent
            .approve_agent_mode(OWNER)
            .expect("the owner may approve Agent mode")
    };
    assert!(approval.is_owner_approved());
    assert_eq!(approval.from, AgentMode::Plan);
    assert_eq!(approval.to, AgentMode::Agent);

    // Gate A: the owner's approval of the brief, through the daemon's RPC layer.
    let device = DeviceId::new();
    let run = rpc
        .approve_gate(run.id, Stage::GateA, device)
        .await
        .expect("gate A approves");
    assert!(
        matches!(run.gate_states[&Stage::GateA], GateState::Approved { .. }),
        "gate A is approved"
    );

    // ---- 5. Execute the plan: the stages run, then the code lands.
    let engine = state.pipeline.clone();
    let run = engine.advance_stage(run.id).await.expect("Idea -> Gate A");
    assert_eq!(run.current_stage, Stage::GateA);
    let run = engine
        .advance_stage(run.id)
        .await
        .expect("an approved gate A lets the run continue");
    assert_eq!(run.current_stage, Stage::Research);
    let run = engine
        .advance_stage(run.id)
        .await
        .expect("Research -> PRD spec");
    assert_eq!(run.current_stage, Stage::PrdSpec);
    let run = engine
        .advance_stage(run.id)
        .await
        .expect("PRD spec -> Gate B");
    assert_eq!(run.current_stage, Stage::GateB);
    let run = rpc
        .approve_gate(run.id, Stage::GateB, device)
        .await
        .expect("gate B approves");
    assert!(
        matches!(run.gate_states[&Stage::GateB], GateState::Approved { .. }),
        "gate B is approved"
    );
    let run = engine
        .advance_stage(run.id)
        .await
        .expect("Gate B -> design");
    assert_eq!(run.current_stage, Stage::Design);
    let run = engine
        .advance_stage(run.id)
        .await
        .expect("design -> plan tasks");
    assert_eq!(run.current_stage, Stage::PlanTasks);
    assert_eq!(
        run.artifacts["plan_tasks"].content, MOCK_RESPONSE,
        "the architect stage reached the mock provider"
    );

    // The scripted answers stand in for what a real model would have written, so
    // they are recorded as artifacts — the same call an agent's output takes.
    engine
        .upsert_artifact(
            run.id,
            stage_artifact(
                "plan_tasks",
                SCRIPTED_PLAN,
                Stage::PlanTasks,
                Role::Architect,
            ),
        )
        .await
        .expect("the plan artifact is recorded");

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("plan tasks -> code");
    assert_eq!(run.current_stage, Stage::Code);
    assert_eq!(
        run.artifacts["code"].content, MOCK_RESPONSE,
        "the coder stage reached the mock provider"
    );
    engine
        .upsert_artifact(
            run.id,
            stage_artifact("code", SCRIPTED_CODE, Stage::Code, Role::Coder),
        )
        .await
        .expect("the code artifact is recorded");

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("code -> review, QA and security");
    assert_eq!(run.current_stage, Stage::ReviewQaSecurity);
    assert_eq!(
        run.artifacts["review_qa_security"].content, MOCK_RESPONSE,
        "the reviewer stage reached the mock provider"
    );
    engine
        .upsert_artifact(
            run.id,
            stage_artifact(
                "review_qa_security",
                SCRIPTED_TESTS,
                Stage::ReviewQaSecurity,
                Role::Reviewer,
            ),
        )
        .await
        .expect("the test artifact is recorded");
    assert!(
        run.spent_cents > 0,
        "the mock model's calls are metered, however cheap they are"
    );

    // The pipeline wrote its artifacts to the project's factory directory.
    let factory_code = state
        .store
        .read_artifact(project.id, "code")
        .await
        .expect("the code artifact is readable");
    assert_eq!(factory_code, SCRIPTED_CODE);

    // ---- 6. The plan's files land in the project's working tree.
    let mut planned = parse_plan_steps(SCRIPTED_PLAN);
    assert_eq!(planned.len(), 4, "unexpected plan: {planned:?}");
    planned.sort();

    let mut files = parse_file_blocks(SCRIPTED_CODE).expect("the code answer carries file blocks");
    files.extend(parse_file_blocks(SCRIPTED_TESTS).expect("the test answer carries file blocks"));
    let written =
        write_generated_files(&project_dir, &files).expect("the planned files are written");
    let mut written_sorted = written.clone();
    written_sorted.sort();
    assert_eq!(
        written_sorted, planned,
        "the code writes exactly the files the plan named"
    );
    for path in &written {
        assert!(
            project_dir.join(path).is_file(),
            "{path} is on disk in the project's working tree"
        );
    }

    // ---- 7. The generated tests run green.
    let tested = run_cargo(&project_dir, &["test"])
        .await
        .expect("cargo test runs");
    assert!(tested.success, "cargo test failed:\n{}", tested.output());
    assert_eq!(
        passed_test_count(&tested.stdout),
        2,
        "the library test and the integration test pass:\n{}",
        tested.output()
    );

    // ---- 8. The artifact builds.
    let built = run_cargo(&project_dir, &["build"])
        .await
        .expect("cargo build runs");
    assert!(built.success, "cargo build failed:\n{}", built.output());
    let binary = binary_path(&project_dir);
    assert!(binary.is_file(), "no binary at {}", binary.display());

    // ---- 9. The binary prints what the request asked for.
    let greeting = run_binary(&project_dir, &[GREETING_NAME])
        .await
        .expect("the built binary runs");
    assert!(
        greeting.success,
        "the binary exited non-zero:\n{}",
        greeting.output()
    );
    assert_eq!(greeting.stdout.trim(), "Hello, Ada!");
    let default_greeting = run_binary(&project_dir, &[])
        .await
        .expect("the built binary runs without an argument");
    assert_eq!(default_greeting.stdout.trim(), "Hello, world!");

    // ---- 10. The run's state and its whole event log read back.
    //
    // The approvals are proved from the event log rather than from the runs
    // `approve_gate` returned: a gate decision is the one event that carries a
    // `device_id`, and reading that column back is exactly what `Store::get_events`
    // used to fail on (`append_event` binds a 16-byte UUID blob, `event_from_row`
    // read it as an integer). A green `get_events` over a log holding two decisions
    // is the regression evidence for that store defect.
    let stored = rpc.get_run(run.id).await.expect("the run is readable");
    assert_eq!(stored.current_stage, Stage::ReviewQaSecurity);

    let events = rpc
        .get_events(run.id)
        .await
        .expect("the run's whole event log is readable");
    let decisions: Vec<&Event> = events
        .iter()
        .filter(|event| event.kind == EventKind::GateDecision)
        .collect();
    assert_eq!(
        decisions.len(),
        2,
        "one decision per approved gate: {decisions:?}"
    );
    assert_eq!(decisions[0].stage, Stage::GateA);
    assert_eq!(decisions[1].stage, Stage::GateB);
    for decision in &decisions {
        assert_eq!(
            decision.device_id,
            Some(device),
            "the decision records the device that approved it"
        );
        assert_eq!(decision.payload["decision"], json!("approved"));
        assert_eq!(decision.payload["by"], json!(device.0.to_string()));
    }
}

/// The daemon state one end-to-end run needs: a store under `data_dir`, a provider
/// router whose only model is the mock provider, and the managers `DaemonState`
/// requires.
///
/// [`warshad::start_daemon`] is not used because it opens a socket and registers no
/// role routing; this drives the same [`WarshaRpc`] the socket serves, without a
/// real HTTP round trip.
async fn daemon_state(data_dir: &Path) -> Arc<DaemonState> {
    std::fs::create_dir_all(data_dir).expect("the data directory is made");
    let store = Arc::new(
        Store::open_at(data_dir.join("warsha.db"))
            .await
            .expect("the store opens"),
    );

    // The one model on the router is the mock provider: no key, no network, and a
    // stage call costs a fraction of a cent.
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(MockProvider::new(MOCK_PROVIDER)));
    for role in [
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Coder,
        Role::Reviewer,
    ] {
        router.set_role_routing(RoleRouting {
            role,
            targets: vec![RoutingTarget {
                provider_id: MOCK_PROVIDER.to_string(),
                model_id: MOCK_MODEL.to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    let providers = Arc::new(RwLock::new(router));
    let pipeline = Arc::new(PipelineEngine::new(store.clone(), providers.clone()));

    let identity = DeviceIdentity::generate("e2e daemon".to_string()).expect("a device identity");
    let (event_tx, _receiver) = broadcast::channel::<Event>(64);
    let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared();
    let mcp: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes.clone()));
    let previews = Arc::new(LivePreviewManager::new(processes.clone()));

    Arc::new(DaemonState {
        config: DaemonConfig {
            data_dir: data_dir.to_path_buf(),
            auth_token: "e2e-token".to_string(),
            ..DaemonConfig::default()
        },
        store,
        providers,
        pipeline,
        backends: BackendFactory::all_available(),
        github: None,
        devices: Arc::new(DeviceRegistry::new(identity)),
        event_tx,
        backend_kits: Arc::new(RwLock::new(HashMap::new())),
        crash_reports: Arc::new(RwLock::new(InMemoryCrashReportStore::new())),
        store_reviews: Arc::new(RwLock::new(InMemoryStoreReviewStore::new())),
        agent_loop: Arc::new(RwLock::new(AgentLoop::new())),
        processes,
        mcp,
        previews,
    })
}

/// An artifact as a stage's role would have recorded it.
fn stage_artifact(name: &str, content: &str, stage: Stage, role: Role) -> Artifact {
    let now = Utc::now();
    Artifact {
        name: name.to_string(),
        content: content.to_string(),
        stage,
        role: Some(role),
        created_at: now,
        updated_at: now,
        version: 1,
    }
}

/// One file a scripted answer carries: a path inside the project, and its contents.
#[derive(Debug, Clone, PartialEq, Eq)]
struct GeneratedFile {
    path: String,
    contents: String,
}

/// The marker that opens a file block: `--- FILE: src/main.rs ---`.
const FILE_MARKER: &str = "--- FILE:";

/// The paths a plan names, in order: every line that starts with `<number>. `.
fn parse_plan_steps(plan: &str) -> Vec<String> {
    plan.lines()
        .filter_map(|line| {
            let (number, path) = line.trim().split_once(". ")?;
            if number.is_empty() || !number.chars().all(|digit| digit.is_ascii_digit()) {
                return None;
            }
            let path = path.trim();
            if path.is_empty() {
                None
            } else {
                Some(path.to_string())
            }
        })
        .collect()
}

/// Every file block a scripted answer carries, in the order the answer names them.
fn parse_file_blocks(answer: &str) -> Result<Vec<GeneratedFile>, String> {
    let mut files = Vec::new();
    let mut open: Option<(String, Vec<&str>)> = None;

    for line in answer.lines() {
        match file_block_path(line) {
            Some(path) => {
                if let Some((path, body)) = open.take() {
                    files.push(finish_block(path, &body)?);
                }
                open = Some((path, Vec::new()));
            }
            None => {
                if let Some((_, body)) = open.as_mut() {
                    body.push(line);
                }
            }
        }
    }
    if let Some((path, body)) = open.take() {
        files.push(finish_block(path, &body)?);
    }

    if files.is_empty() {
        return Err("the answer carries no `--- FILE: … ---` block".to_string());
    }
    Ok(files)
}

/// The path a file-block marker names, if this line is one.
fn file_block_path(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix(FILE_MARKER)?;
    let path = rest.trim().strip_suffix("---")?.trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/// One parsed block, refused if its path or contents cannot be written.
fn finish_block(path: String, body: &[&str]) -> Result<GeneratedFile, String> {
    if !is_safe_relative_path(&path) {
        return Err(format!(
            "refused path `{path}`: only a plain relative path inside the project is written"
        ));
    }
    let contents = body.join("\n").trim_end().to_string();
    if contents.is_empty() {
        return Err(format!("the block for `{path}` is empty"));
    }
    Ok(GeneratedFile { path, contents })
}

/// Whether `path` is a plain relative path: no root, no drive prefix, no `..`.
///
/// A backslash is refused too, so a path names the same file on every OS and the
/// plan's `src/lib.rs` is the file that is written.
fn is_safe_relative_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.contains('\\') {
        return false;
    }
    let candidate = Path::new(trimmed);
    !candidate.is_absolute()
        && candidate
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

/// Write the generated files into the project, returning their relative paths.
fn write_generated_files(
    project_dir: &Path,
    files: &[GeneratedFile],
) -> Result<Vec<String>, String> {
    let mut written = Vec::with_capacity(files.len());
    for file in files {
        if !is_safe_relative_path(&file.path) {
            return Err(format!("refused path `{}`", file.path));
        }
        let target = project_dir.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
        }
        std::fs::write(&target, format!("{}\n", file.contents))
            .map_err(|error| format!("could not write {}: {error}", target.display()))?;
        written.push(file.path.clone());
    }
    Ok(written)
}

/// One finished command: what ran, whether it succeeded, and what it said.
struct CommandRun {
    command: String,
    success: bool,
    stdout: String,
    stderr: String,
}

impl CommandRun {
    fn from_output(command: String, output: std::process::Output) -> Self {
        Self {
            command,
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }

    /// Both streams plus the command line, for a failure message.
    fn output(&self) -> String {
        format!(
            "$ {}\n--- stdout ---\n{}\n--- stderr ---\n{}",
            self.command, self.stdout, self.stderr
        )
    }
}

/// Run `cargo <args>` inside the generated project.
///
/// `--offline` and `CARGO_NET_OFFLINE` keep the nested build off the network (the
/// generated project has no dependencies, so nothing needs a registry), and the
/// target directory is pinned inside the project so an inherited `CARGO_TARGET_DIR`
/// cannot point this build at the workspace's own lock.
async fn run_cargo(project_dir: &Path, args: &[&str]) -> Result<CommandRun, String> {
    let program = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let output = tokio::process::Command::new(&program)
        .current_dir(project_dir)
        .arg("--offline")
        .args(args)
        .env("CARGO_TARGET_DIR", project_dir.join("target"))
        .env("CARGO_NET_OFFLINE", "true")
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|error| format!("could not run {program}: {error}"))?;
    Ok(CommandRun::from_output(
        format!("{program} --offline {}", args.join(" ")),
        output,
    ))
}

/// The path `cargo build` writes the generated binary to.
fn binary_path(project_dir: &Path) -> PathBuf {
    project_dir
        .join("target")
        .join("debug")
        .join(format!("{PACKAGE_NAME}{}", std::env::consts::EXE_SUFFIX))
}

/// Run the built binary with `args`, from the project directory.
async fn run_binary(project_dir: &Path, args: &[&str]) -> Result<CommandRun, String> {
    let binary = binary_path(project_dir);
    if !binary.is_file() {
        return Err(format!("no binary at {}", binary.display()));
    }
    let output = tokio::process::Command::new(&binary)
        .current_dir(project_dir)
        .args(args)
        .output()
        .await
        .map_err(|error| format!("could not run {}: {error}", binary.display()))?;
    Ok(CommandRun::from_output(
        format!("{} {}", binary.display(), args.join(" ")),
        output,
    ))
}

/// How many tests the `test result: ok. N passed` lines of a run report, summed.
fn passed_test_count(output: &str) -> usize {
    output
        .lines()
        .filter_map(|line| {
            let rest = line.split_once("test result: ok. ")?.1;
            rest.split_whitespace().next()?.parse::<usize>().ok()
        })
        .sum()
}
