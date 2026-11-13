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
use crate::agent_workflow::{
    AgentMode, AgentWorkflowError, ModeTransition, SlashCommand, TodoItem,
};

/// What can go wrong with a run's agent session.
#[derive(Debug, Error)]
pub enum AgentSessionError {
    /// The run already has a session.
    #[error("run {0} already has an agent session")]
    Duplicate(RunId),
    /// The run has no session. The id is the run's own (`Ulid` Display), so a caller
    /// reads the run it named instead of a numeric debug of it.
    #[error("run {0} has no agent session")]
    NotFound(RunId),
    /// The run's mode manager refused the switch — a blank approver, or the mode
    /// the run is already in.
    #[error(transparent)]
    Mode(#[from] AgentWorkflowError),
    /// The map lock was poisoned by a panicking holder.
    #[error("the agent-session registry is poisoned")]
    Poisoned,
}

/// What one run's loop reports in answer to `agent.state` with its run id.
///
/// The same four facts the daemon-wide record carries, read off the run's own
/// loop: which mode its next turn runs in, every switch it recorded (each naming
/// the device that approved it), its own todos, and whether a model call is wired.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunAgentState {
    /// The mode the run's next turn runs in.
    pub mode: AgentMode,
    /// Every switch the run's loop recorded, oldest first.
    pub approvals: Vec<ModeTransition>,
    /// What the run's loop said it would do, one item per turn.
    pub todos: Vec<TodoItem>,
    /// Whether a model call is wired behind the run's Agent-mode turn.
    pub model_wired: bool,
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

    /// The loop one run registered, cloned out of the map.
    ///
    /// The map lock is released before the caller awaits the loop, so a turn never
    /// holds it across an await and two runs still turn side by side.
    fn session(&self, run_id: RunId) -> Result<Arc<AsyncMutex<AgentLoop>>> {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&run_id)
            .cloned()
            .ok_or(AgentSessionError::NotFound(run_id))
    }

    /// Run one turn in `run_id`'s own loop.
    pub async fn run_turn(
        &self,
        run_id: RunId,
        input: &str,
        skills: &[SlashCommand],
    ) -> Result<AgentTurnResult> {
        let session = self.session(run_id)?;
        let mut agent = session.lock().await;
        Ok(agent.run_turn(input, skills).await)
    }

    /// Approve Agent mode for `run_id`'s own loop, on `approved_by`'s authority.
    ///
    /// OD-E2b: this is what makes the plan → approve → execute flow reachable over
    /// the wire. The mode lives in the loop the registry holds for the run, and the
    /// registry holds that loop for the run's session (built once at `runs.start`),
    /// so the approval is still there when the run's next turn starts — the loop is
    /// not rebuilt per turn. No snapshot is written: the daemon's settings record is
    /// the daemon-wide conversation's, and a run's loop does not outlive this
    /// process, so a run approval that cannot survive is fail-closed by construction
    /// (a restart starts the run's loop in Plan again).
    ///
    /// The approval rule is the loop's, unchanged: a blank approver is
    /// [`AgentWorkflowError::ApprovalRequired`], so the registry cannot invent one.
    pub async fn approve_agent_mode(
        &self,
        run_id: RunId,
        approved_by: &str,
    ) -> Result<ModeTransition> {
        let session = self.session(run_id)?;
        let mut agent = session.lock().await;
        Ok(agent.approve_agent_mode(approved_by)?)
    }

    /// Return `run_id`'s own loop to Plan. Always allowed — the read-only direction
    /// is free, exactly as it is for the daemon-wide loop.
    pub async fn return_to_plan_mode(&self, run_id: RunId) -> Result<ModeTransition> {
        let session = self.session(run_id)?;
        let mut agent = session.lock().await;
        Ok(agent.return_to_plan_mode()?)
    }

    /// The four facts `agent.state` reports for one run.
    pub async fn state(&self, run_id: RunId) -> Result<RunAgentState> {
        let session = self.session(run_id)?;
        let agent = session.lock().await;
        Ok(RunAgentState {
            mode: agent.mode(),
            approvals: agent.mode_manager.history.clone(),
            todos: agent.todo_list.items.clone(),
            model_wired: agent.has_router(),
        })
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

    /// OD-E2b at the registry: the switch lands on the run's own loop, survives into
    /// that run's next turn (the loop is not rebuilt per turn), leaves every other
    /// run in Plan, and can be read back.
    #[tokio::test]
    async fn a_run_switch_sticks_across_turns_and_only_for_that_run() {
        let sessions = RunAgentSessions::new();
        let run_a = run();
        let run_b = run();
        sessions
            .insert(run_a, AgentLoop::new())
            .expect("A registers");
        sessions
            .insert(run_b, AgentLoop::new())
            .expect("B registers");

        let approved = sessions
            .approve_agent_mode(run_a, "owner")
            .await
            .expect("A's loop is approved");
        assert_eq!(approved.to, AgentMode::Agent);
        assert_eq!(
            sessions.state(run_a).await.expect("A reports").mode,
            AgentMode::Agent
        );
        assert_eq!(
            sessions.state(run_b).await.expect("B reports").mode,
            AgentMode::Plan
        );

        // The approval is in the loop the next turn runs on, not in a per-turn copy.
        let a = sessions
            .run_turn(run_a, "write file a.md: one", &[])
            .await
            .expect("A turns");
        let b = sessions
            .run_turn(run_b, "write file b.md: two", &[])
            .await
            .expect("B turns");
        assert_eq!(a.mode, AgentMode::Agent);
        assert_eq!(b.mode, AgentMode::Plan);

        // The read half names the switch, and the read-only direction is free.
        let state = sessions.state(run_a).await.expect("A reports");
        assert_eq!(
            state
                .approvals
                .last()
                .map(|switch| switch.approved_by.as_str()),
            Some("owner")
        );
        let back = sessions
            .return_to_plan_mode(run_a)
            .await
            .expect("A returns");
        assert_eq!(back.to, AgentMode::Plan);
        assert_eq!(
            sessions.state(run_a).await.expect("A reports").mode,
            AgentMode::Plan
        );
    }

    /// The registry cannot approve on nobody's authority, and an unknown run is
    /// named rather than silently given a loop.
    #[tokio::test]
    async fn a_blank_approver_and_an_unknown_run_are_both_refused() {
        let sessions = RunAgentSessions::new();
        let run_id = run();
        sessions
            .insert(run_id, AgentLoop::new())
            .expect("registers");
        assert!(matches!(
            sessions.approve_agent_mode(run_id, "").await,
            Err(AgentSessionError::Mode(
                AgentWorkflowError::ApprovalRequired
            ))
        ));
        let unknown = run();
        assert!(matches!(
            sessions.approve_agent_mode(unknown, "owner").await,
            Err(AgentSessionError::NotFound(id)) if id == unknown
        ));
        assert!(matches!(
            sessions.return_to_plan_mode(unknown).await,
            Err(AgentSessionError::NotFound(id)) if id == unknown
        ));
        assert!(matches!(
            sessions.state(unknown).await,
            Err(AgentSessionError::NotFound(id)) if id == unknown
        ));
    }
}
