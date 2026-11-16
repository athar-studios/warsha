use crate::PipelineError;
use chrono::Utc;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use warsha_core::{Event, EventKind, RunId, SessionId, SessionStatus};
use warsha_store::Store;

pub const MAX_TAIL_LINES: usize = 256;

#[derive(Clone)]
pub struct LiveSessionHandle {
    pub session_id: SessionId,
    pub run_id: RunId,
    pub pid: Option<u32>,
    pub tail: Arc<Mutex<VecDeque<String>>>,
    pub stop_tx: tokio::sync::watch::Sender<bool>,
}

#[derive(Clone)]
pub struct LiveSessionManager {
    sessions: Arc<RwLock<HashMap<SessionId, LiveSessionHandle>>>,
}

impl LiveSessionManager {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(
        &self,
        session_id: SessionId,
        run_id: RunId,
        pid: Option<u32>,
    ) -> tokio::sync::watch::Receiver<bool> {
        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
        let handle = LiveSessionHandle {
            session_id,
            run_id,
            pid,
            tail: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_TAIL_LINES))),
            stop_tx,
        };
        self.sessions.write().await.insert(session_id, handle);
        stop_rx
    }

    pub async fn update_pid(&self, session_id: SessionId, pid: u32) {
        if let Some(handle) = self.sessions.write().await.get_mut(&session_id) {
            handle.pid = Some(pid);
        }
    }

    pub async fn push_tail_line(&self, session_id: SessionId, line: &str) {
        // Redact secrets using the existing redaction layer
        let redacted = warsha_core::mask_secrets(&crate::guardrails::mask_secrets(line));
        let sessions = self.sessions.read().await;
        if let Some(handle) = sessions.get(&session_id) {
            let mut tail = handle.tail.lock().await;
            if tail.len() >= MAX_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(redacted);
        }
    }

    pub async fn get_tail(&self, session_id: SessionId) -> Vec<String> {
        let sessions = self.sessions.read().await;
        if let Some(handle) = sessions.get(&session_id) {
            let tail = handle.tail.lock().await;
            tail.iter().cloned().collect()
        } else {
            Vec::new()
        }
    }

    pub async fn unregister(&self, session_id: SessionId) {
        self.sessions.write().await.remove(&session_id);
    }

    pub async fn stop_session(&self, session_id: SessionId, store: &Store) -> crate::Result<()> {
        let handle = {
            let sessions = self.sessions.read().await;
            sessions.get(&session_id).cloned()
        };

        if let Some(handle) = handle {
            let _ = handle.stop_tx.send(true);

            if let Some(pid) = handle.pid {
                kill_process_group(pid);
            }

            store
                .finish_session(session_id, SessionStatus::Stopped, Utc::now())
                .await
                .map_err(|e| PipelineError::Other(format!("Database error: {e}")))?;

            let event = Event {
                id: ulid::Ulid::new(),
                run_id: handle.run_id,
                stage: warsha_core::Stage::Code,
                role: Some(warsha_core::Role::Coder),
                kind: EventKind::SessionEnded,
                payload: serde_json::json!({
                    "session_id": session_id.to_string(),
                    "status": "stopped",
                    "receipt": "owner stop",
                    "reason": "owner stop",
                }),
                cost_cents: None,
                tokens: None,
                created_at: Utc::now(),
                device_id: None,
            };
            let _ = store.append_event(&event).await;
            self.unregister(session_id).await;
        } else {
            if let Some(session) = store
                .get_session(session_id)
                .await
                .map_err(|e| PipelineError::Other(format!("Database error: {e}")))?
            {
                if session.status != SessionStatus::Done
                    && session.status != SessionStatus::Failed
                    && session.status != SessionStatus::Stopped
                {
                    store
                        .finish_session(session_id, SessionStatus::Stopped, Utc::now())
                        .await
                        .map_err(|e| PipelineError::Other(format!("Database error: {e}")))?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(unix)]
pub fn kill_process_group(pid: u32) {
    use libc::{kill, SIGKILL, SIGTERM};
    let pgid = pid as i32;
    unsafe {
        kill(-pgid, SIGTERM);
    }
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
        unsafe {
            kill(-pgid, SIGKILL);
        }
    });
}

#[cfg(windows)]
pub fn kill_process_group(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .output();
}
