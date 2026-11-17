use crate::stream::*;
use std::sync::Arc;
use tempfile::tempdir;
use warsha_core::{EventKind, RunId, SessionId, SessionStatus};
use warsha_pipeline::coding_backend::{CodingBackend, CodingTask, Sandbox};
use warsha_pipeline::live_session::LiveSessionManager;
use warsha_store::Store;

#[test]
fn test_claude_stream_fixture_sequence() {
    let fixture = include_str!("../../tests/fixtures/claude_stream.jsonl");
    let mut all_events = Vec::new();

    for line in fixture.lines() {
        let events = parse_claude_stream_line(line);
        all_events.extend(events);
    }

    assert_eq!(all_events.len(), 7);

    // 1. SessionStarted
    match &all_events[0] {
        StreamEvent::SessionStarted {
            cli_session_id,
            model,
        } => {
            assert_eq!(cli_session_id.as_deref(), Some("claude-sess-123"));
            assert_eq!(model.as_deref(), Some("claude-3-5-sonnet-20241022"));
        }
        other => panic!("expected SessionStarted, got {:?}", other),
    }

    // 2. StatusChanged
    match &all_events[1] {
        StreamEvent::StatusChanged { status } => {
            assert_eq!(status, "thinking");
        }
        other => panic!("expected StatusChanged, got {:?}", other),
    }

    // 3. ToolStarted (Bash)
    match &all_events[2] {
        StreamEvent::ToolStarted { tool, target } => {
            assert_eq!(tool, "Bash");
            assert_eq!(target, "git"); // Target must be command name without arguments!
        }
        other => panic!("expected ToolStarted, got {:?}", other),
    }

    // 4. ToolFinished
    match &all_events[3] {
        StreamEvent::ToolFinished { tool, status, .. } => {
            assert_eq!(tool, "unknown");
            assert_eq!(status, "success");
        }
        other => panic!("expected ToolFinished, got {:?}", other),
    }

    // 5. ToolStarted (Edit) & FileTouched
    match &all_events[4] {
        StreamEvent::ToolStarted { tool, target } => {
            assert_eq!(tool, "Edit");
            assert_eq!(target, "src/main.rs");
        }
        other => panic!("expected ToolStarted, got {:?}", other),
    }
    match &all_events[5] {
        StreamEvent::FileTouched { path, action } => {
            assert_eq!(path, "src/main.rs");
            assert_eq!(action, "modify");
        }
        other => panic!("expected FileTouched, got {:?}", other),
    }

    // 6. SessionEnded
    match &all_events[6] {
        StreamEvent::SessionEnded {
            status,
            duration_ms,
            usage,
        } => {
            assert_eq!(status, "success");
            assert_eq!(*duration_ms, Some(1500));
            assert!(usage.is_some());
            let u = usage.as_ref().unwrap();
            assert_eq!(u.input, 120);
            assert_eq!(u.output, 80);
            assert_eq!(u.cost_cents, Some(3));
        }
        other => panic!("expected SessionEnded, got {:?}", other),
    }
}

#[test]
fn test_codex_stream_fixture_sequence() {
    let fixture = include_str!("../../tests/fixtures/codex_stream.jsonl");
    let mut all_events = Vec::new();

    for line in fixture.lines() {
        let events = parse_codex_stream_line(line);
        all_events.extend(events);
    }

    assert_eq!(all_events.len(), 5);

    // 1. SessionStarted
    match &all_events[0] {
        StreamEvent::SessionStarted {
            cli_session_id,
            model,
        } => {
            assert_eq!(cli_session_id.as_deref(), Some("codex-sess-456"));
            assert_eq!(model.as_deref(), Some("o3-mini"));
        }
        other => panic!("expected SessionStarted, got {:?}", other),
    }

    // 2. ToolStarted (exec)
    match &all_events[1] {
        StreamEvent::ToolStarted { tool, target } => {
            assert_eq!(tool, "exec");
            assert_eq!(target, "cargo"); // Target must be command name without arguments!
        }
        other => panic!("expected ToolStarted, got {:?}", other),
    }

    // 3. FileTouched
    match &all_events[2] {
        StreamEvent::FileTouched { path, action } => {
            assert_eq!(path, "src/lib.rs");
            assert_eq!(action, "modify");
        }
        other => panic!("expected FileTouched, got {:?}", other),
    }

    // 4. ToolFinished
    match &all_events[3] {
        StreamEvent::ToolFinished {
            tool,
            duration_ms,
            status,
            ..
        } => {
            assert_eq!(tool, "exec");
            assert_eq!(*duration_ms, Some(350));
            assert_eq!(status, "success");
        }
        other => panic!("expected ToolFinished, got {:?}", other),
    }

    // 5. SessionEnded
    match &all_events[4] {
        StreamEvent::SessionEnded {
            status,
            duration_ms,
            usage,
        } => {
            assert_eq!(status, "done");
            assert_eq!(*duration_ms, Some(1200));
            assert!(usage.is_some());
            let u = usage.as_ref().unwrap();
            assert_eq!(u.input, 200);
            assert_eq!(u.output, 90);
            assert_eq!(u.cost_cents, Some(6));
        }
        other => panic!("expected SessionEnded, got {:?}", other),
    }
}

#[test]
fn test_opencode_stream_fixture_sequence() {
    let fixture = include_str!("../../tests/fixtures/opencode_stream.jsonl");
    let mut all_events = Vec::new();

    for line in fixture.lines() {
        let events = parse_opencode_stream_line(line);
        all_events.extend(events);
    }

    assert_eq!(all_events.len(), 8);

    // 1. SessionStarted
    match &all_events[0] {
        StreamEvent::SessionStarted {
            cli_session_id,
            model,
        } => {
            assert_eq!(
                cli_session_id.as_deref(),
                Some("ses_e14721b8dffe2AMxpbQc4R24AO")
            );
            assert!(model.is_none());
        }
        other => panic!("expected SessionStarted, got {:?}", other),
    }

    // 2. ToolStarted (running)
    match &all_events[1] {
        StreamEvent::ToolStarted { tool, target } => {
            assert_eq!(tool, "shell");
            assert_eq!(target, "echo");
        }
        other => panic!("expected ToolStarted, got {:?}", other),
    }

    // 3. ToolStarted (completed)
    match &all_events[2] {
        StreamEvent::ToolStarted { tool, target } => {
            assert_eq!(tool, "shell");
            assert_eq!(target, "echo");
        }
        other => panic!("expected ToolStarted, got {:?}", other),
    }

    // 4. ToolFinished (shell completed)
    match &all_events[3] {
        StreamEvent::ToolFinished {
            tool,
            target,
            duration_ms,
            status,
        } => {
            assert_eq!(tool, "shell");
            assert_eq!(target, "echo");
            assert_eq!(*duration_ms, Some(100));
            assert_eq!(status, "success");
        }
        other => panic!("expected ToolFinished, got {:?}", other),
    }

    // 5. ToolStarted (write)
    match &all_events[4] {
        StreamEvent::ToolStarted { tool, target } => {
            assert_eq!(tool, "write");
            assert_eq!(target, "src/test.txt");
        }
        other => panic!("expected ToolStarted, got {:?}", other),
    }

    // 6. ToolFinished (write)
    match &all_events[5] {
        StreamEvent::ToolFinished {
            tool,
            target,
            duration_ms,
            status,
        } => {
            assert_eq!(tool, "write");
            assert_eq!(target, "src/test.txt");
            assert_eq!(*duration_ms, Some(50));
            assert_eq!(status, "success");
        }
        other => panic!("expected ToolFinished, got {:?}", other),
    }

    // 7. FileTouched
    match &all_events[6] {
        StreamEvent::FileTouched { path, action } => {
            assert_eq!(path, "src/test.txt");
            assert_eq!(action, "modify");
        }
        other => panic!("expected FileTouched, got {:?}", other),
    }

    // 8. SessionEnded
    match &all_events[7] {
        StreamEvent::SessionEnded {
            status,
            duration_ms,
            usage,
        } => {
            assert_eq!(status, "success");
            assert_eq!(*duration_ms, None);
            assert!(usage.is_some());
            let u = usage.as_ref().unwrap();
            assert_eq!(u.input, 150);
            assert_eq!(u.output, 50);
            assert_eq!(u.total, 200);
            assert_eq!(u.cost_cents, None);
        }
        other => panic!("expected SessionEnded, got {:?}", other),
    }
}

#[test]
fn test_content_rule_canary() {
    let claude_fixture = include_str!("../../tests/fixtures/claude_stream.jsonl");
    let codex_fixture = include_str!("../../tests/fixtures/codex_stream.jsonl");

    let canaries = [
        "CANARY_MODEL_SECRET_12345",
        "CANARY_FILE_CONTENT_SECRET_67890",
        "CANARY_EDIT_TEXT_54321",
        "CANARY_MODEL_OUTPUT_99999",
        "CANARY_ARGS_SECRET_7777",
    ];

    let mut event_debugs = Vec::new();

    for line in claude_fixture.lines() {
        for ev in parse_claude_stream_line(line) {
            event_debugs.push(format!("{:?}", ev));
        }
    }

    for line in codex_fixture.lines() {
        for ev in parse_codex_stream_line(line) {
            event_debugs.push(format!("{:?}", ev));
        }
    }

    for canary in canaries {
        for ev_str in &event_debugs {
            assert!(
                !ev_str.contains(canary),
                "CONTENT RULE VIOLATION: Canary '{canary}' leaked into event representation: {ev_str}"
            );
        }
    }
}

#[tokio::test]
async fn test_killed_cli_leaves_failed_or_stopped_session() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let store = Store::open_at(db_path).await.expect("open store");

    // Create a project and run
    let project_id = warsha_core::ProjectId::new();
    let project = warsha_core::Project {
        id: project_id,
        name: "test-proj".to_string(),
        description: "test".to_string(),
        language: "rust".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: Some(dir.path().to_string_lossy().to_string()),
        ..Default::default()
    };
    store
        .create_project(&project)
        .await
        .expect("create project");

    let run_id = RunId::new();
    let run = warsha_core::Run {
        id: run_id,
        project_id,
        current_stage: warsha_core::Stage::Code,
        gate_states: std::collections::HashMap::new(),
        artifacts: std::collections::HashMap::new(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        status: warsha_core::RunStatus::Running,
        budget_cents: Some(1000),
        spent_cents: 0,
        worktree_path: None,
        worktree_branch: None,
        confinement: None,
    };
    store.create_run(&run).await.expect("create run");

    let session_id = SessionId::new();
    let session = warsha_core::Session {
        id: session_id,
        run_id,
        project_id,
        role: warsha_core::Role::Coder,
        backend: "sh".to_string(),
        provider: "cli".to_string(),
        model: "default".to_string(),
        status: SessionStatus::Working,
        started_at: chrono::Utc::now(),
        ended_at: None,
        parent_session_id: None,
        cli_session_id: None,
    };
    store
        .create_session(&session)
        .await
        .expect("create session");

    let mgr = LiveSessionManager::new();
    let backend = crate::CliBackend::new(
        "sh-sleep",
        "sh",
        vec!["-c".to_string(), "sleep 30".to_string()],
    );

    let mut sandbox = Sandbox::new(dir.path().to_path_buf());
    sandbox.session_id = Some(session_id);
    sandbox.live_sessions = Some(Arc::new(mgr.clone()));

    let task = CodingTask {
        id: ulid::Ulid::new(),
        worktree_path: None,
        run_id,
        title: "sleep task".to_string(),
        description: "sleep".to_string(),
        repo_path: dir.path().to_path_buf(),
        branch_name: "test".to_string(),
        base_branch: "HEAD".to_string(),
        files: vec![],
        context: std::collections::HashMap::new(),
    };

    // Spawn backend execution in background
    let backend_arc = Arc::new(backend);
    let task_handle = tokio::spawn(async move { backend_arc.execute(task, &sandbox).await });

    // Wait briefly for process to be running and registered
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // Call stop_session
    mgr.stop_session(session_id, &store)
        .await
        .expect("stop session");

    // Await task completion
    let res = task_handle.await.expect("task join");
    assert!(res.is_err(), "task should fail when killed");

    // Verify session in store is stopped or failed, never working
    let stored_session = store
        .get_session(session_id)
        .await
        .expect("get session")
        .expect("session exists");
    assert_ne!(stored_session.status, SessionStatus::Working);
    assert!(
        matches!(
            stored_session.status,
            SessionStatus::Stopped | SessionStatus::Failed
        ),
        "expected Stopped or Failed, got {:?}",
        stored_session.status
    );
}

#[tokio::test]
async fn test_stalled_stream_does_not_block_run_loop() {
    let dir = tempdir().expect("tempdir");
    let session_id = SessionId::new();
    let run_id = RunId::new();
    let mgr = LiveSessionManager::new();

    // A CLI process that sleeps for 1 second without output (stalled stream)
    let backend = crate::CliBackend::new(
        "sh-stall",
        "sh",
        vec!["-c".to_string(), "sleep 1".to_string()],
    );
    let mut sandbox = Sandbox::new(dir.path().to_path_buf());
    sandbox.session_id = Some(session_id);
    sandbox.live_sessions = Some(Arc::new(mgr));

    let task = CodingTask {
        id: ulid::Ulid::new(),
        worktree_path: None,
        run_id,
        title: "stall test".to_string(),
        description: "stall".to_string(),
        repo_path: dir.path().to_path_buf(),
        branch_name: "test".to_string(),
        base_branch: "HEAD".to_string(),
        files: vec![],
        context: std::collections::HashMap::new(),
    };

    let start = std::time::Instant::now();
    let res = backend.execute(task, &sandbox).await;
    let elapsed = start.elapsed();

    // Must not block indefinitely; finishes when child finishes
    assert!(res.is_ok(), "backend should finish: {:?}", res);
    assert!(elapsed < std::time::Duration::from_secs(10));
}

#[tokio::test]
async fn test_no_stream_telemetry_label() {
    let dir = tempdir().expect("tempdir");
    let session_id = SessionId::new();
    let run_id = RunId::new();

    let backend = crate::BuiltinBackend;
    let mut sandbox = Sandbox::new(dir.path().to_path_buf());
    sandbox.session_id = Some(session_id);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    sandbox.event_sender = Some(tx);

    let task = CodingTask {
        id: ulid::Ulid::new(),
        worktree_path: None,
        run_id,
        title: "builtin test".to_string(),
        description: "test".to_string(),
        repo_path: dir.path().to_path_buf(),
        branch_name: "test".to_string(),
        base_branch: "HEAD".to_string(),
        files: vec![],
        context: std::collections::HashMap::new(),
    };

    let res = backend
        .execute(task, &sandbox)
        .await
        .expect("builtin execute");
    assert!(res.success);

    // Read emitted events
    let mut events = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        events.push(ev);
    }

    assert_eq!(events.len(), 2);
    assert_eq!(events[0].kind, EventKind::SessionStarted);
    assert_eq!(
        events[0].payload["note"],
        "no live telemetry for this backend"
    );
    assert_eq!(events[1].kind, EventKind::SessionEnded);
    assert_eq!(
        events[1].payload["note"],
        "no live telemetry for this backend"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn test_opencode_end_to_end_streams_events_and_flags_estimated_usage() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().expect("tempdir");
    let script_path = dir.path().join("fake-opencode");
    let fixture = include_str!("../../tests/fixtures/opencode_stream.jsonl");
    let script = format!("#!/bin/sh\ncat << 'EOF'\n{}\nEOF\n", fixture);
    std::fs::write(&script_path, script).expect("write fake opencode");
    std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
        .expect("chmod fake opencode");

    let backend = crate::CliBackend::new(
        "opencode",
        script_path.to_str().expect("utf8"),
        vec![
            "run".to_string(),
            "--format".to_string(),
            "json".to_string(),
        ],
    );

    let session_id = SessionId::new();
    let run_id = RunId::new();
    let mut sandbox = Sandbox::new(dir.path().to_path_buf());
    sandbox.session_id = Some(session_id);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    sandbox.event_sender = Some(tx);

    let task = CodingTask {
        id: ulid::Ulid::new(),
        worktree_path: None,
        run_id,
        title: "opencode test".to_string(),
        description: "stream test".to_string(),
        repo_path: dir.path().to_path_buf(),
        branch_name: "test".to_string(),
        base_branch: "HEAD".to_string(),
        files: vec![],
        context: std::collections::HashMap::new(),
    };

    let res = backend
        .execute(task, &sandbox)
        .await
        .expect("opencode execute");
    assert!(res.success);
    let usage = res.usage.expect("usage parsed");
    assert_eq!(usage.input, 150);
    assert_eq!(usage.output, 50);
    assert_eq!(usage.total, 200);
    assert_eq!(usage.cost_cents, None);

    let mut events = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        events.push(ev);
    }

    assert!(events.iter().any(|e| e.kind == EventKind::ToolStarted));
    assert!(events.iter().any(|e| e.kind == EventKind::ToolFinished));
    assert!(events.iter().any(|e| e.kind == EventKind::FileTouched));
    let ended = events
        .iter()
        .find(|e| e.kind == EventKind::SessionEnded)
        .expect("SessionEnded event");
    assert_eq!(ended.payload["usage_estimated"], true);
    assert_eq!(ended.payload["usage"]["estimated"], true);
}
