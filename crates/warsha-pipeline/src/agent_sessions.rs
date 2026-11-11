//! Per-run agent sessions (ENGINE E2 slice).
//!
//! One daemon-wide [`AgentLoop`] shares one conversation across every run. This
//! registry gives each run its own loop, keyed by `RunId`, so two runs cannot share
//! context, todos, questions or mode state. The caller builds the loop (router, MCP
//! manager, permission source) and hands it in; the registry owns only the map and
//! serialises access to each loop.
//!
//! The map lock is a `std::sync::Mutex` held only long enough to clone an `Arc`;
//! each loop is a `tokio::sync::Mutex` locked across the turn, so a turn never
//! holds the map lock across an await.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;
use warsha_core::RunId;

use crate::agent_loop::{AgentLoop, AgentTurnResult};
use crate::agent_workflow::SlashCommand;

/// What can go wrong with a run's agent session.
#[derive(Debug, Error)]
pub enum AgentSessionError {
    /// The run already has a session.
    #[error("run {0:?} already has an agent session")]
    Duplicate(RunId),
    /// The run has no session.
    #[error("run {0:?} has no agent session")]
    NotFound(RunId),
    /// The map lock was poisoned by a panicking holder.
    #[error("the agent-session registry is poisoned")]
    Poisoned,
}

pub type Result<T> = std::result::Result<T, AgentSessionError>;

/// One agent loop per run, isolated from every other run.
#[derive(Default)]
pub struct RunAgentSessions {
    sessions: Mutex<HashMap<RunId, Arc<AsyncMutex<AgentLoop>>>>,
}

impl RunAgentSessions {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// How many runs have a session.
    pub fn len(&self) -> usize {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }

    /// Whether no run has a session.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Whether `run_id` has a session.
    pub fn contains(&self, run_id: RunId) -> bool {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains_key(&run_id)
    }

    /// Register the loop one run works in; a second insert for the same run is refused.
    pub fn insert(&self, run_id: RunId, agent: AgentLoop) -> Result<()> {
        let mut sessions = self
            .sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if sessions.contains_key(&run_id) {
            return Err(AgentSessionError::Duplicate(run_id));
        }
        sessions.insert(run_id, Arc::new(AsyncMutex::new(agent)));
        Ok(())
    }

    /// Remove a run's session; the loop is dropped when its last turn finishes.
    pub fn remove(&self, run_id: RunId) -> bool {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&run_id)
            .is_some()
    }

    /// Run one turn in `run_id`'s own loop.
    pub async fn run_turn(
        &self,
        run_id: RunId,
        input: &str,
        skills: &[SlashCommand],
    ) -> Result<AgentTurnResult> {
        let session = {
            let sessions = self
                .sessions
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            sessions
                .get(&run_id)
                .cloned()
                .ok_or(AgentSessionError::NotFound(run_id))?
        };
        let mut agent = session.lock().await;
        Ok(agent.run_turn(input, skills).await)
    }
}

#[cfg(test)]
mod e2 {
    use super::*;
    use crate::agent_workflow::AgentMode;

    fn run() -> RunId {
        RunId::new()
    }

    #[tokio::test]
    async fn two_runs_keep_independent_mode_and_context() {
        let sessions = RunAgentSessions::new();
        let mut approved = AgentLoop::new();
        approved
            .approve_agent_mode("owner")
            .expect("an approval is accepted");
        let run_a = run();
        let run_b = run();
        sessions.insert(run_a, approved).expect("A registers");
        sessions
            .insert(run_b, AgentLoop::new())
            .expect("B registers");

        let a = sessions
            .run_turn(run_a, "alpha", &[])
            .await
            .expect("A turns");
        let b = sessions
            .run_turn(run_b, "beta", &[])
            .await
            .expect("B turns");

        // A was approved into Agent mode; B is still in Plan. One run's approval
        // cannot leak into another run's loop.
        assert_eq!(a.mode, AgentMode::Agent);
        assert_eq!(b.mode, AgentMode::Plan);
        assert!(
            b.response.contains("Plan (nothing executed)"),
            "{}",
            b.response
        );
    }

    #[test]
    fn a_duplicate_run_is_refused_and_the_first_loop_stays() {
        let sessions = RunAgentSessions::new();
        let run_id = run();
        sessions
            .insert(run_id, AgentLoop::new())
            .expect("the first insert");
        assert!(matches!(
            sessions.insert(run_id, AgentLoop::new()),
            Err(AgentSessionError::Duplicate(id)) if id == run_id
        ));
        assert_eq!(sessions.len(), 1);
    }

    #[tokio::test]
    async fn an_unknown_run_is_not_found() {
        let sessions = RunAgentSessions::new();
        assert!(matches!(
            sessions.run_turn(run(), "hello", &[]).await,
            Err(AgentSessionError::NotFound(_))
        ));
    }

    #[test]
    fn removal_drops_the_session() {
        let sessions = RunAgentSessions::new();
        let run_id = run();
        sessions
            .insert(run_id, AgentLoop::new())
            .expect("registers");
        assert!(sessions.contains(run_id));
        assert!(sessions.remove(run_id));
        assert!(!sessions.contains(run_id));
        assert!(!sessions.remove(run_id));
        assert!(sessions.is_empty());
    }
}
