//! The real-LLM failure path (GAP 3): a stage whose model call is refused ends the
//! run *as failed*, with a scrubbed event on its log — and it never puts the API key
//! anywhere the owner would have to hunt for it.
//!
//! The measured break: `execute_stage` propagated the dispatch error with `?` and
//! left the run `Running` at the half-started stage with nothing in its log saying
//! why. A caller polling the walk saw a run that would never move — and the walk
//! path kept re-offering the failing stage. This file pins the fix: `Failed` status
//! persisted, one `EventKind::Error` with `"action": "stage_failed"`, the refusal
//! message scrubbed of the credential, and no retry storm afterwards.
//!
//! The endpoint is not the Internet: AGENTS.md forbids network calls to real model
//! APIs in tests, so the failure is produced by a loopback stub — the same OpenAI
//!-compatible shape, the same refusal, no provider and no bill. The stub answers
//! `400` with the request's own `Authorization` header echoed into the error body,
//! which is the leakiest refusal a scrubbing test can be given: the key is *in* the
//! provider's error text, and the assertion is that it does not survive into the
//! run's record. The key itself is syntactically valid and works nowhere.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use warsha_core::{DeviceId, Event, EventKind, Project, ProjectId, RunStatus, Stage};
use warsha_pipeline::{settings::SettingsStore, PipelineEngine};
use warsha_providers::ProviderRouter;
use warsha_store::Store;

/// A key shaped like the real thing and refused by every endpoint on earth.
const BAD_KEY: &str = "sk-invalid-test-key-12345";
/// The model the environment path is pointed at — the pipeline's documented default.
const MODEL: &str = "bzl/deepseek-v4-flash-0731free";

/// A fresh temp directory preferring cargo's `CARGO_TARGET_TMPDIR` — the same
/// three-way fallback the daemon tests use (`crates/warshad/tests/events_ws_auth.rs`):
/// some Windows machines protect `%TEMP%` against even creating a directory there
/// (`Access is denied`), and the target dir is writable wherever the build ran.
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
        name: "failure-walk".to_string(),
        description: "تطبيق يفشل عند أول مكالمة حقيقية".to_string(),
        language: "ar".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path: None,
        repo_url: None,
    };
    store.create_project(&project).await.expect("a project");
    project.id
}

/// The leaking stub: every request gets `400 Bad Request` whose JSON error body
/// quotes the `Authorization` header it was sent — the worst-case provider error
/// for a secret, because it carries the key back into the client's error text.
///
/// Served from loopback; the walk talks to this socket and nothing else.
async fn start_key_echoing_stub() -> std::net::SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("the stub binds a loopback port");
    let addr = listener.local_addr().expect("the stub knows its address");
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _peer)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                // Read the request head (the credential lives in it), then answer.
                let mut accumulated: Vec<u8> = Vec::new();
                let mut chunk = [0u8; 4096];
                while let Ok(read) = socket.read(&mut chunk).await {
                    if read == 0 {
                        break;
                    }
                    accumulated.extend_from_slice(&chunk[..read]);
                    if accumulated.windows(4).any(|window| window == b"\r\n\r\n")
                        || accumulated.len() > 65_536
                    {
                        break;
                    }
                }
                let text = String::from_utf8_lossy(&accumulated).into_owned();
                let auth = text
                    .lines()
                    .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
                    .unwrap_or("Authorization: <none>")
                    .to_string();
                let body = format!("{{\"error\":{{\"message\":\"Invalid API key; got {auth}\"}}}}");
                let reply = format!(
                    "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(reply.as_bytes()).await;
                let _ = socket.shutdown().await;
            });
        }
    });
    addr
}

/// How many `stage_failed` error events the log carries, and their text.
fn stage_failures(events: &[Event]) -> Vec<&Event> {
    events
        .iter()
        .filter(|event| event.kind == EventKind::Error && event.payload["action"] == "stage_failed")
        .collect()
}

#[tokio::test]
async fn a_refused_real_llm_call_fails_the_run_records_it_and_scrubs_the_key() {
    let stub = start_key_echoing_stub().await;
    // The environment path of `dispatch_chat`: a real-shaped key (that works
    // nowhere), the default model id, and a base URL pointed at the loopback stub.
    // This test binary is the only one reading these names in this process, and it
    // reads them the way `EnvLlmConfig::from_env` does, on the dispatch itself.
    std::env::set_var("WARSHA_LLM_API_KEY", BAD_KEY);
    std::env::set_var("WARSHA_LLM_BASE_URL", format!("http://{stub}/v1"));
    std::env::set_var("WARSHA_LLM_MODEL", MODEL);
    std::env::remove_var("WARSHA_LLM_PROVIDER");

    let result: Result<(), String> = async {
        let (dir, store) = fresh_store().await;
        let engine = PipelineEngine::<SettingsStore>::new_test(
            store.clone(),
            Arc::new(RwLock::new(ProviderRouter::new())),
        );
        let project_id = create_project(&store).await;
        let run = engine
            .start_run(project_id, "تطبيق حجز مواعيد يفشل عند النموذج")
            .await
            .map_err(|error| format!("the run starts: {error}"))?;

        // The walk first lands on the pending GateA — nothing is dispatched for a
        // gate. Approving it is what puts Research, the first executed stage, next:
        // the env-openai call happens there, the stub refuses it, and the walk must
        // come back with the failed run in hand rather than hanging at a stage
        // that cannot run.
        let at_gate = engine
            .advance_to_next_gate(run.id)
            .await
            .map_err(|error| format!("the walk reaches Gate A: {error}"))?;
        assert_eq!(at_gate.current_stage, Stage::GateA);
        engine
            .approve_gate(at_gate.id, Stage::GateA, DeviceId::new())
            .await
            .map_err(|error| format!("Gate A approves: {error}"))?;

        let walked = engine
            .advance_to_next_gate(run.id)
            .await
            .map_err(|error| format!("the walk answers the failure: {error}"))?;
        assert_eq!(
            walked.status,
            RunStatus::Failed,
            "the walk reports the failed run"
        );
        assert_eq!(
            walked.current_stage,
            Stage::Research,
            "the walk stopped at the stage that failed"
        );

        // The status is persisted, not just returned.
        let stored = store
            .get_run(run.id)
            .await
            .map_err(|error| format!("the run reloads: {error}"))?;
        assert_eq!(stored.status, RunStatus::Failed);

        // Exactly one `EventKind::Error` with the stage_failed action, naming the
        // stage and carrying the scrubbed refusal.
        let events = store
            .get_events(run.id)
            .await
            .map_err(|error| format!("events read back: {error}"))?;
        let failures = stage_failures(&events);
        if failures.len() != 1 {
            return Err(format!(
                "exactly one stage_failed event, got {}",
                failures.len()
            ));
        }
        let failure = failures[0];
        if failure.payload["stage"] != "research" {
            return Err(format!("the event names its stage: {:?}", failure.payload));
        }
        let message = failure.payload["message"].as_str().unwrap_or_default();
        if !message.contains("400") {
            return Err(format!(
                "the message carries the provider's refusal: {message}"
            ));
        }
        if message.contains(BAD_KEY) {
            return Err(format!(
                "the event message still carries the API key: {message}"
            ));
        }
        if !message.contains("[redacted]") {
            return Err(format!(
                "the scrub left no mark of what it removed: {message}"
            ));
        }

        // The key is nowhere in the run's record either.
        let run_json = serde_json::to_string(&stored).expect("the run serializes");
        if run_json.contains(BAD_KEY) {
            return Err("the serialized run carries the API key".to_string());
        }
        for event in &events {
            if event.payload.to_string().contains(BAD_KEY) {
                return Err(format!("event {} carries the API key", event.id));
            }
        }

        // No hang, no retry storm: walking a failed run answers it immediately and
        // dispatches nothing new — the single refusal is still the whole log — and
        // a direct advance refuses the failed run outright.
        let again = engine
            .advance_to_next_gate(run.id)
            .await
            .map_err(|error| format!("the failed run answers a second walk: {error}"))?;
        assert_eq!(again.status, RunStatus::Failed);
        let events_after = store
            .get_events(run.id)
            .await
            .expect("events read back after the second walk");
        if stage_failures(&events_after).len() != 1 {
            return Err(format!(
                "the second walk re-ran the stage: {} failure events",
                stage_failures(&events_after).len()
            ));
        }
        engine
            .advance_stage(run.id)
            .await
            .expect_err("a failed run does not advance");

        // The database file itself — every table, WAL included — holds no key.
        drop(engine);
        drop(store);
        for extra in ["", "-wal", "-shm"] {
            let path = dir.path().join(format!("pipeline.db{extra}"));
            if let Ok(bytes) = std::fs::read(&path) {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                if text.contains(BAD_KEY) {
                    return Err(format!("the store file {path:?} carries the API key"));
                }
            }
        }
        Ok(())
    }
    .await;

    std::env::remove_var("WARSHA_LLM_API_KEY");
    std::env::remove_var("WARSHA_LLM_BASE_URL");
    std::env::remove_var("WARSHA_LLM_MODEL");
    if let Err(problem) = result {
        panic!("{problem}");
    }
}
