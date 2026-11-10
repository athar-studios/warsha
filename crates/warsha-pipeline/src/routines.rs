//! Routines — a scheduled-task abstraction for Warsha's Simple-mode automations.
//!
//! Goose is **not** a dependency of this repository yet (the root `Cargo.toml`
//! carries it only as a commented-out placeholder), so routines are modelled
//! here in-house behind the [`RoutineRunner`] trait. A future Goose-backed
//! scheduler (recipes + cron) implements that trait and drives
//! [`RoutineRegistry::tick`]; the schedule parser, the registry and the state
//! machine stay as they are.
//!
//! The cron support in this module is deliberately minimal — `every N
//! seconds|minutes|hours` and `daily at HH:MM` (UTC). Full cron is deferred to
//! the Goose-backed scheduler rather than duplicated here.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{watch, RwLock};

/// Seconds in a minute.
const SECONDS_PER_MINUTE: u64 = 60;
/// Seconds in an hour.
const SECONDS_PER_HOUR: u64 = 3_600;
/// Seconds in a day.
const SECONDS_PER_DAY: u64 = 86_400;

/// Stable identifier of a routine, unique inside one [`RoutineRegistry`].
pub type RoutineId = String;

/// When a routine comes due.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutineSchedule {
    /// A minimal cron expression; see the module docs for the accepted forms.
    Cron(String),
    /// Run every `n` seconds after the previous run (`0` is rejected).
    IntervalSeconds(u64),
    /// Only ever run by an explicit [`RoutineAction::RunNow`].
    Manual,
}

/// Where a routine is in its lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutineState {
    /// Registered and eligible for scheduling.
    Idle,
    /// Handed out by [`RoutineRegistry::tick`] and not yet completed.
    Running,
    /// Paused by the owner; never due until resumed.
    Paused,
    /// The last run failed; parked until the owner resumes or runs it manually.
    Failed(String),
}

impl RoutineState {
    /// Short label used in errors and in the Simple-mode routines list.
    pub fn label(&self) -> &'static str {
        match self {
            RoutineState::Idle => "idle",
            RoutineState::Running => "running",
            RoutineState::Paused => "paused",
            RoutineState::Failed(_) => "failed",
        }
    }
}

/// An owner action on a registered routine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutineAction {
    /// Run once now, regardless of the schedule.
    RunNow,
    /// Stop scheduling the routine.
    Pause,
    /// Allow a paused or failed routine to be scheduled again.
    Resume,
}

/// A scheduled task: what it does is [`Routine::description`], the runner
/// decides the how.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Routine {
    /// Unique identifier.
    pub id: RoutineId,
    /// Owner-facing name shown in Simple mode.
    pub name: String,
    /// Plain-language description of what the routine does.
    pub description: String,
    /// When the routine comes due.
    pub schedule: RoutineSchedule,
    /// Current lifecycle state.
    pub state: RoutineState,
    /// Unix seconds of the last accepted run, if any.
    pub last_run_unix: Option<u64>,
}

impl Routine {
    /// Create an idle routine with an empty description.
    pub fn new(id: &str, name: &str, schedule: RoutineSchedule) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: String::new(),
            schedule,
            state: RoutineState::Idle,
            last_run_unix: None,
        }
    }

    /// Attach the plain-language description shown in Simple mode.
    pub fn with_description(mut self, description: &str) -> Self {
        self.description = description.to_string();
        self
    }
}

/// Errors raised by the registry and by routine runners.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum RoutineError {
    /// No routine carries that id.
    #[error("routine not found: {0}")]
    NotFound(RoutineId),
    /// A routine with that id is already registered.
    #[error("routine already registered: {0}")]
    Duplicate(RoutineId),
    /// The id is empty or whitespace only.
    #[error("invalid routine id: {0:?}")]
    InvalidId(String),
    /// The schedule expression could not be parsed.
    #[error("invalid routine schedule: {0:?}")]
    InvalidSchedule(String),
    /// The requested action does not fit the current state.
    #[error("cannot {action} routine {routine}: state is {state}")]
    InvalidState {
        /// Routine the action targeted.
        routine: RoutineId,
        /// Action that was refused.
        action: String,
        /// State the routine was in.
        state: String,
    },
    /// A runner reported a failure.
    #[error("routine runner failed: {0}")]
    Runner(String),
}

/// Executes routines. A Goose-backed scheduler is one implementation.
///
/// Only [`RoutineRunner::run`] is required; the default `pause`/`resume` are
/// no-ops for runners that keep no external state.
pub trait RoutineRunner {
    /// Run `routine` once. An `Err` parks the routine in [`RoutineState::Failed`].
    fn run(&self, routine: &Routine) -> Result<(), RoutineError>;

    /// Stop scheduling `routine` outside Warsha, if the runner tracks that.
    fn pause(&self, _routine: &Routine) -> Result<(), RoutineError> {
        Ok(())
    }

    /// Allow `routine` to be scheduled again, if the runner tracks that.
    fn resume(&self, _routine: &Routine) -> Result<(), RoutineError> {
        Ok(())
    }
}

/// A routine runner for production when no external runner (such as Goose) is configured.
///
/// Refuses routine execution with an explicit error indicating that routines are unavailable.
#[derive(Debug, Default, Clone, Copy)]
pub struct UnavailableRoutineRunner;

impl UnavailableRoutineRunner {
    /// Create a new unavailable routine runner.
    pub fn new() -> Self {
        Self
    }
}

impl RoutineRunner for UnavailableRoutineRunner {
    fn run(&self, routine: &Routine) -> Result<(), RoutineError> {
        Err(RoutineError::Runner(format!(
            "routine runner unavailable: no scheduler configured for routine '{}'",
            routine.id
        )))
    }

    fn pause(&self, _routine: &Routine) -> Result<(), RoutineError> {
        Ok(())
    }

    fn resume(&self, _routine: &Routine) -> Result<(), RoutineError> {
        Ok(())
    }
}

/// The set of registered routines and the due-date arithmetic.
#[derive(Debug, Default)]
pub struct RoutineRegistry {
    routines: HashMap<RoutineId, Routine>,
}

impl RoutineRegistry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a routine, rejecting a bad id, a duplicate and a bad schedule.
    pub fn register(&mut self, routine: Routine) -> Result<RoutineId, RoutineError> {
        if routine.id.trim().is_empty() {
            return Err(RoutineError::InvalidId(routine.id));
        }
        if self.routines.contains_key(&routine.id) {
            return Err(RoutineError::Duplicate(routine.id));
        }
        parse_schedule(&routine.schedule)?;
        let id = routine.id.clone();
        self.routines.insert(id.clone(), routine);
        Ok(id)
    }

    /// Every routine, ordered by id so Simple-mode lists stay stable.
    pub fn list(&self) -> Vec<&Routine> {
        let mut routines: Vec<&Routine> = self.routines.values().collect();
        routines.sort_by(|left, right| left.id.cmp(&right.id));
        routines
    }

    /// The routine with `id`, if registered.
    pub fn get(&self, id: &str) -> Option<&Routine> {
        self.routines.get(id)
    }

    /// Remove and return the routine with `id`.
    pub fn remove(&mut self, id: &str) -> Option<Routine> {
        self.routines.remove(id)
    }

    /// Collect the routines that are due at `now_unix` and mark them
    /// [`RoutineState::Running`], stamping `last_run_unix`.
    ///
    /// Paused, running and failed routines are never due: a failure needs an
    /// explicit [`RoutineAction::Resume`] (or [`RoutineAction::RunNow`]) first.
    pub fn tick(&mut self, now_unix: u64) -> Vec<RoutineId> {
        let mut due = Vec::new();
        for routine in self.routines.values_mut() {
            if routine.state != RoutineState::Idle {
                continue;
            }
            let Ok(schedule) = parse_schedule(&routine.schedule) else {
                continue;
            };
            if !is_due(schedule, routine.last_run_unix, now_unix) {
                continue;
            }
            routine.state = RoutineState::Running;
            routine.last_run_unix = Some(now_unix);
            due.push(routine.id.clone());
        }
        due.sort();
        due
    }

    /// Apply an owner action, calling `runner` for the side effects.
    pub fn apply(
        &mut self,
        id: &str,
        action: RoutineAction,
        now_unix: u64,
        runner: &dyn RoutineRunner,
    ) -> Result<(), RoutineError> {
        let routine = self
            .routines
            .get(id)
            .ok_or_else(|| RoutineError::NotFound(id.to_string()))?
            .clone();

        match action {
            RoutineAction::RunNow => {
                if routine.state == RoutineState::Running {
                    return Err(self.invalid_state(&routine, "run"));
                }
                let mut running = routine;
                running.state = RoutineState::Running;
                running.last_run_unix = Some(now_unix);
                self.routines.insert(running.id.clone(), running.clone());
                match runner.run(&running) {
                    Ok(()) => self.complete(id, None),
                    Err(error) => {
                        self.complete(id, Some(error.to_string()))?;
                        Err(error)
                    }
                }
            }
            RoutineAction::Pause => {
                if !matches!(routine.state, RoutineState::Idle | RoutineState::Failed(_)) {
                    return Err(self.invalid_state(&routine, "pause"));
                }
                runner.pause(&routine)?;
                self.set_state(id, RoutineState::Paused)
            }
            RoutineAction::Resume => {
                if !matches!(
                    routine.state,
                    RoutineState::Paused | RoutineState::Failed(_)
                ) {
                    return Err(self.invalid_state(&routine, "resume"));
                }
                runner.resume(&routine)?;
                self.set_state(id, RoutineState::Idle)
            }
        }
    }

    /// Record the outcome of a routine handed out by [`Self::tick`].
    pub fn complete(&mut self, id: &str, failure: Option<String>) -> Result<(), RoutineError> {
        let state = match failure {
            Some(message) => RoutineState::Failed(message),
            None => RoutineState::Idle,
        };
        self.set_state(id, state)
    }

    /// Record the outcome of a routine handed out by [`Self::tick`]; alias for [`Self::complete`].
    pub fn finish(&mut self, id: &str, failure: Option<String>) -> Result<(), RoutineError> {
        self.complete(id, failure)
    }

    fn set_state(&mut self, id: &str, state: RoutineState) -> Result<(), RoutineError> {
        let routine = self
            .routines
            .get_mut(id)
            .ok_or_else(|| RoutineError::NotFound(id.to_string()))?;
        routine.state = state;
        Ok(())
    }

    fn invalid_state(&self, routine: &Routine, action: &str) -> RoutineError {
        RoutineError::InvalidState {
            routine: routine.id.clone(),
            action: action.to_string(),
            state: routine.state.label().to_string(),
        }
    }
}

/// Schedules and executes routines periodically in the background.
#[derive(Clone)]
pub struct RoutineScheduler {
    registry: Arc<RwLock<RoutineRegistry>>,
    runner: Arc<dyn RoutineRunner + Send + Sync>,
    shutdown_tx: watch::Sender<bool>,
    shutdown_rx: watch::Receiver<bool>,
}

impl RoutineScheduler {
    /// Create a new routine scheduler driving `registry` using `runner`.
    pub fn new(
        registry: Arc<RwLock<RoutineRegistry>>,
        runner: Arc<dyn RoutineRunner + Send + Sync>,
    ) -> Self {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        Self {
            registry,
            runner,
            shutdown_tx,
            shutdown_rx,
        }
    }

    /// Reference to the inner registry lock.
    pub fn registry(&self) -> &Arc<RwLock<RoutineRegistry>> {
        &self.registry
    }

    /// Reference to the routine runner.
    pub fn runner(&self) -> &Arc<dyn RoutineRunner + Send + Sync> {
        &self.runner
    }

    /// Acquires write lock on registry, ticks the registry, runs any due routines
    /// with runner, and records completion via `finish`.
    pub async fn tick_once(&self, now_unix: u64) -> Vec<RoutineId> {
        let mut registry = self.registry.write().await;
        let due_ids = registry.tick(now_unix);
        for id in &due_ids {
            if let Some(routine) = registry.get(id).cloned() {
                let res = self.runner.run(&routine);
                let failure = res.err().map(|e| e.to_string());
                let _ = registry.finish(id, failure);
            }
        }
        due_ids
    }

    /// Spawns a background task calling `tick_once` periodically until stopped.
    pub fn start(&self, interval: std::time::Duration) -> tokio::task::JoinHandle<()> {
        let scheduler = self.clone();
        let mut shutdown_rx = self.shutdown_rx.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = shutdown_rx.changed() => {
                        if *shutdown_rx.borrow() {
                            break;
                        }
                    }
                    _ = ticker.tick() => {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        scheduler.tick_once(now).await;
                    }
                }
            }
        })
    }

    /// Signals the background loop to exit.
    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(true);
    }

    /// Applies `RoutineAction::RunNow`.
    pub async fn run_now(&self, id: &str) -> Result<(), RoutineError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut registry = self.registry.write().await;
        registry.apply(id, RoutineAction::RunNow, now, self.runner.as_ref())
    }

    /// Applies `RoutineAction::Pause`.
    pub async fn pause(&self, id: &str) -> Result<(), RoutineError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut registry = self.registry.write().await;
        registry.apply(id, RoutineAction::Pause, now, self.runner.as_ref())
    }

    /// Applies `RoutineAction::Resume`.
    pub async fn resume(&self, id: &str) -> Result<(), RoutineError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut registry = self.registry.write().await;
        registry.apply(id, RoutineAction::Resume, now, self.runner.as_ref())
    }
}

/// The schedule forms this module understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParsedSchedule {
    /// A fixed gap in seconds between runs.
    Interval(u64),
    /// A daily wall-clock time, UTC.
    Daily { hour: u8, minute: u8 },
}

fn invalid_schedule(expression: &str) -> RoutineError {
    RoutineError::InvalidSchedule(expression.to_string())
}

/// Parse a [`RoutineSchedule`] into the schedule forms this module can time.
///
/// [`RoutineSchedule::Manual`] has no parsed form because it is never due.
fn parse_schedule(schedule: &RoutineSchedule) -> Result<Option<ParsedSchedule>, RoutineError> {
    match schedule {
        RoutineSchedule::Manual => Ok(None),
        RoutineSchedule::IntervalSeconds(seconds) => {
            if *seconds == 0 {
                return Err(invalid_schedule("interval 0"));
            }
            Ok(Some(ParsedSchedule::Interval(*seconds)))
        }
        RoutineSchedule::Cron(expression) => parse_cron(expression).map(Some),
    }
}

/// Parse the minimal cron subset: `every N seconds|minutes|hours` and
/// `daily at HH:MM` (UTC). Anything else is rejected — full cron waits for the
/// Goose-backed scheduler.
fn parse_cron(expression: &str) -> Result<ParsedSchedule, RoutineError> {
    let normalized = expression
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();

    if let Some(rest) = normalized.strip_prefix("every ") {
        let mut parts = rest.split(' ');
        let amount = parts.next().ok_or_else(|| invalid_schedule(expression))?;
        let unit = parts.next().ok_or_else(|| invalid_schedule(expression))?;
        if parts.next().is_some() {
            return Err(invalid_schedule(expression));
        }
        let amount: u64 = amount.parse().map_err(|_| invalid_schedule(expression))?;
        if amount == 0 {
            return Err(invalid_schedule(expression));
        }
        let seconds = match unit {
            "second" | "seconds" => amount,
            "minute" | "minutes" => amount.saturating_mul(SECONDS_PER_MINUTE),
            "hour" | "hours" => amount.saturating_mul(SECONDS_PER_HOUR),
            _ => return Err(invalid_schedule(expression)),
        };
        return Ok(ParsedSchedule::Interval(seconds));
    }

    if let Some(rest) = normalized.strip_prefix("daily at ") {
        let (hour, minute) = rest
            .split_once(':')
            .ok_or_else(|| invalid_schedule(expression))?;
        let hour: u8 = hour.parse().map_err(|_| invalid_schedule(expression))?;
        let minute: u8 = minute.parse().map_err(|_| invalid_schedule(expression))?;
        if hour > 23 || minute > 59 {
            return Err(invalid_schedule(expression));
        }
        return Ok(ParsedSchedule::Daily { hour, minute });
    }

    Err(invalid_schedule(expression))
}

/// Whether a parsed schedule is due at `now_unix`.
///
/// A never-run interval routine is due at the first tick it is idle for; a
/// never-run daily routine waits for its wall-clock time (and therefore runs at
/// the first tick at or after that time on the day it is registered).
fn is_due(schedule: Option<ParsedSchedule>, last_run_unix: Option<u64>, now_unix: u64) -> bool {
    let Some(schedule) = schedule else {
        return false;
    };
    match (schedule, last_run_unix) {
        (ParsedSchedule::Interval(_), None) => true,
        (ParsedSchedule::Interval(seconds), Some(last_run)) => {
            last_run.saturating_add(seconds) <= now_unix
        }
        (ParsedSchedule::Daily { hour, minute }, None) => {
            start_of_day_utc(now_unix).saturating_add(daily_offset(hour, minute)) <= now_unix
        }
        (ParsedSchedule::Daily { hour, minute }, Some(last_run)) => {
            next_daily_after(hour, minute, last_run) <= now_unix
        }
    }
}

/// The UTC day of `unix_seconds` starts here.
fn start_of_day_utc(unix_seconds: u64) -> u64 {
    (unix_seconds / SECONDS_PER_DAY) * SECONDS_PER_DAY
}

/// Seconds from midnight to `hour`:`minute`.
fn daily_offset(hour: u8, minute: u8) -> u64 {
    u64::from(hour) * SECONDS_PER_HOUR + u64::from(minute) * SECONDS_PER_MINUTE
}

/// The first UTC wall-clock occurrence of `hour`/`minute` after `after_unix`.
fn next_daily_after(hour: u8, minute: u8, after_unix: u64) -> u64 {
    let today = start_of_day_utc(after_unix).saturating_add(daily_offset(hour, minute));
    if today > after_unix {
        today
    } else {
        today.saturating_add(SECONDS_PER_DAY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    /// Test double that records the calls it receives.
    #[derive(Debug, Default)]
    struct MockRoutineRunner {
        runs: Mutex<Vec<RoutineId>>,
        pauses: Mutex<Vec<RoutineId>>,
        resumes: Mutex<Vec<RoutineId>>,
        fail_next_run: AtomicBool,
    }

    impl MockRoutineRunner {
        fn new() -> Self {
            Self::default()
        }

        fn failing(self) -> Self {
            self.fail_next_run.store(true, Ordering::SeqCst);
            self
        }

        fn run_ids(&self) -> Vec<RoutineId> {
            self.runs.lock().unwrap_or_else(|p| p.into_inner()).clone()
        }

        fn pause_ids(&self) -> Vec<RoutineId> {
            self.pauses
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .clone()
        }

        fn resume_ids(&self) -> Vec<RoutineId> {
            self.resumes
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .clone()
        }
    }

    impl RoutineRunner for MockRoutineRunner {
        fn run(&self, routine: &Routine) -> Result<(), RoutineError> {
            self.runs
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(routine.id.clone());
            if self.fail_next_run.swap(false, Ordering::SeqCst) {
                return Err(RoutineError::Runner(format!(
                    "mock failure for {}",
                    routine.id
                )));
            }
            Ok(())
        }

        fn pause(&self, routine: &Routine) -> Result<(), RoutineError> {
            self.pauses
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(routine.id.clone());
            Ok(())
        }

        fn resume(&self, routine: &Routine) -> Result<(), RoutineError> {
            self.resumes
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(routine.id.clone());
            Ok(())
        }
    }

    const MINUTE: u64 = 60;

    fn registry_with(routines: Vec<Routine>) -> RoutineRegistry {
        let mut registry = RoutineRegistry::new();
        for routine in routines {
            registry.register(routine).unwrap();
        }
        registry
    }

    #[test]
    fn registers_lists_and_removes() {
        let mut registry = registry_with(vec![
            Routine::new(
                "nightly",
                "Nightly",
                RoutineSchedule::Cron("daily at 02:00".into()),
            ),
            Routine::new(
                "heartbeat",
                "Heartbeat",
                RoutineSchedule::IntervalSeconds(300),
            ),
        ]);

        let ids: Vec<&str> = registry.list().iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["heartbeat", "nightly"]);
        assert_eq!(
            registry.get("heartbeat").map(|r| r.name.as_str()),
            Some("Heartbeat")
        );

        let removed = registry.remove("nightly").expect("nightly is registered");
        assert_eq!(removed.id, "nightly");
        assert!(registry.get("nightly").is_none());
        assert!(registry.remove("nightly").is_none());
    }

    #[test]
    fn rejects_duplicate_bad_id_and_bad_schedule() {
        let mut registry = registry_with(vec![Routine::new(
            "heartbeat",
            "Heartbeat",
            RoutineSchedule::IntervalSeconds(300),
        )]);

        let duplicate = registry.register(Routine::new(
            "heartbeat",
            "Again",
            RoutineSchedule::IntervalSeconds(60),
        ));
        assert_eq!(duplicate, Err(RoutineError::Duplicate("heartbeat".into())));

        let blank = registry.register(Routine::new("  ", "Blank", RoutineSchedule::Manual));
        assert!(matches!(blank, Err(RoutineError::InvalidId(_))));

        let zero = registry.register(Routine::new(
            "zero",
            "Zero",
            RoutineSchedule::IntervalSeconds(0),
        ));
        assert!(matches!(zero, Err(RoutineError::InvalidSchedule(_))));

        let nonsense = registry.register(Routine::new(
            "weird",
            "Weird",
            RoutineSchedule::Cron("0 2 * * *".into()),
        ));
        assert!(matches!(nonsense, Err(RoutineError::InvalidSchedule(_))));
    }

    #[test]
    fn tick_returns_due_routines_once() {
        let mut registry = registry_with(vec![Routine::new(
            "heartbeat",
            "Heartbeat",
            RoutineSchedule::IntervalSeconds(5 * MINUTE),
        )]);

        assert_eq!(registry.tick(1_000), vec!["heartbeat".to_string()]);
        assert_eq!(
            registry.get("heartbeat").map(|r| r.state.clone()),
            Some(RoutineState::Running)
        );

        // Still running: not due again even after the interval elapses.
        assert!(registry.tick(1_000 + 10 * MINUTE).is_empty());

        registry.complete("heartbeat", None).unwrap();
        assert_eq!(
            registry.get("heartbeat").map(|r| r.state.clone()),
            Some(RoutineState::Idle)
        );
        assert!(registry.tick(1_000 + 4 * MINUTE).is_empty());
        assert_eq!(
            registry.tick(1_000 + 5 * MINUTE),
            vec!["heartbeat".to_string()]
        );
    }

    #[test]
    fn tick_skips_manual_paused_and_failed() {
        let mut registry = registry_with(vec![
            Routine::new("manual", "Manual", RoutineSchedule::Manual),
            Routine::new("paused", "Paused", RoutineSchedule::IntervalSeconds(MINUTE)),
            Routine::new("broken", "Broken", RoutineSchedule::IntervalSeconds(MINUTE)),
        ]);
        let runner = MockRoutineRunner::new();

        registry
            .apply("paused", RoutineAction::Pause, 0, &runner)
            .unwrap();
        registry
            .apply("broken", RoutineAction::RunNow, 0, &runner)
            .unwrap();
        registry.complete("broken", Some("boom".into())).unwrap();

        assert!(registry.tick(10 * MINUTE).is_empty());
        assert_eq!(
            registry.get("paused").map(|r| r.state.clone()),
            Some(RoutineState::Paused)
        );
        assert_eq!(
            registry.get("broken").map(|r| r.state.clone()),
            Some(RoutineState::Failed("boom".into()))
        );
    }

    #[test]
    fn pause_and_resume_drive_the_runner_and_the_state() {
        let mut registry = registry_with(vec![Routine::new(
            "heartbeat",
            "Heartbeat",
            RoutineSchedule::IntervalSeconds(MINUTE),
        )]);
        let runner = MockRoutineRunner::new();

        registry
            .apply("heartbeat", RoutineAction::Pause, 0, &runner)
            .unwrap();
        assert_eq!(runner.pause_ids(), vec!["heartbeat".to_string()]);
        assert_eq!(
            registry.get("heartbeat").map(|r| r.state.clone()),
            Some(RoutineState::Paused)
        );

        // Pausing twice is refused rather than silently ignored.
        let twice = registry.apply("heartbeat", RoutineAction::Pause, 0, &runner);
        assert!(matches!(twice, Err(RoutineError::InvalidState { .. })));

        registry
            .apply("heartbeat", RoutineAction::Resume, 0, &runner)
            .unwrap();
        assert_eq!(runner.resume_ids(), vec!["heartbeat".to_string()]);
        assert_eq!(
            registry.get("heartbeat").map(|r| r.state.clone()),
            Some(RoutineState::Idle)
        );

        // Resuming an idle routine is refused too.
        let again = registry.apply("heartbeat", RoutineAction::Resume, 0, &runner);
        assert!(matches!(again, Err(RoutineError::InvalidState { .. })));
    }

    #[test]
    fn manual_run_ignores_the_schedule_and_records_the_time() {
        let mut registry = registry_with(vec![Routine::new(
            "report",
            "Weekly report",
            RoutineSchedule::Manual,
        )]);
        let runner = MockRoutineRunner::new();

        registry
            .apply("report", RoutineAction::RunNow, 4_242, &runner)
            .unwrap();

        assert_eq!(runner.run_ids(), vec!["report".to_string()]);
        let routine = registry.get("report").expect("report is registered");
        assert_eq!(routine.state, RoutineState::Idle);
        assert_eq!(routine.last_run_unix, Some(4_242));
        assert!(registry.tick(1_000_000).is_empty());
    }

    #[test]
    fn a_failing_runner_parks_the_routine() {
        let mut registry = registry_with(vec![Routine::new(
            "report",
            "Report",
            RoutineSchedule::Manual,
        )]);
        let runner = MockRoutineRunner::new().failing();

        let outcome = registry.apply("report", RoutineAction::RunNow, 10, &runner);
        assert!(matches!(outcome, Err(RoutineError::Runner(_))));
        assert!(matches!(
            registry.get("report").map(|r| r.state.clone()),
            Some(RoutineState::Failed(_))
        ));

        // Resume clears the failure; the routine is schedulable again.
        registry
            .apply("report", RoutineAction::Resume, 20, &runner)
            .unwrap();
        assert_eq!(
            registry.get("report").map(|r| r.state.clone()),
            Some(RoutineState::Idle)
        );
    }

    #[test]
    fn daily_cron_comes_due_once_per_day() {
        let mut registry = registry_with(vec![Routine::new(
            "daily",
            "Daily digest",
            RoutineSchedule::Cron("daily at 09:30".into()),
        )]);

        // 2026-01-01T09:00:00Z — before the wall-clock time.
        let before = 1_767_258_000;
        assert!(registry.tick(before).is_empty());

        // 2026-01-01T09:30:00Z — first run.
        assert_eq!(
            registry.tick(before + 30 * MINUTE),
            vec!["daily".to_string()]
        );
        registry.complete("daily", None).unwrap();

        // Later the same day: no second run.
        assert!(registry.tick(before + 5 * 3_600).is_empty());
        // Next day: due again.
        assert_eq!(
            registry.tick(before + 24 * 3_600 + 30 * MINUTE),
            vec!["daily".to_string()]
        );
    }

    #[test]
    fn cron_parser_accepts_the_documented_forms() {
        assert_eq!(
            parse_cron("every 15 Minutes").unwrap(),
            ParsedSchedule::Interval(900)
        );
        assert_eq!(
            parse_cron("every 2 hours").unwrap(),
            ParsedSchedule::Interval(7_200)
        );
        assert_eq!(
            parse_cron("daily at 23:59").unwrap(),
            ParsedSchedule::Daily {
                hour: 23,
                minute: 59
            }
        );

        for invalid in [
            "every 0 minutes",
            "every 5 decades",
            "daily at 24:00",
            "daily at 9",
            "*/5 * * * *",
        ] {
            assert!(
                matches!(parse_cron(invalid), Err(RoutineError::InvalidSchedule(_))),
                "{invalid} should be rejected"
            );
        }
    }

    #[test]
    fn applying_an_unknown_routine_is_not_found() {
        let mut registry = RoutineRegistry::new();
        let runner = MockRoutineRunner::new();
        let outcome = registry.apply("ghost", RoutineAction::RunNow, 0, &runner);
        assert_eq!(outcome, Err(RoutineError::NotFound("ghost".into())));
    }

    #[tokio::test]
    async fn scheduler_interval_ticking() {
        let mut registry = RoutineRegistry::new();
        registry
            .register(Routine::new(
                "task1",
                "Periodic Task",
                RoutineSchedule::IntervalSeconds(10),
            ))
            .unwrap();

        let registry = Arc::new(RwLock::new(registry));
        let runner = Arc::new(MockRoutineRunner::new());
        let scheduler = RoutineScheduler::new(Arc::clone(&registry), runner.clone());

        // At t=0, interval task is due immediately on first tick
        let ticked = scheduler.tick_once(0).await;
        assert_eq!(ticked, vec!["task1".to_string()]);
        assert_eq!(runner.run_ids(), vec!["task1".to_string()]);

        // At t=5, not due yet
        let ticked = scheduler.tick_once(5).await;
        assert!(ticked.is_empty());
        assert_eq!(runner.run_ids(), vec!["task1".to_string()]);

        // At t=10, due again
        let ticked = scheduler.tick_once(10).await;
        assert_eq!(ticked, vec!["task1".to_string()]);
        assert_eq!(
            runner.run_ids(),
            vec!["task1".to_string(), "task1".to_string()]
        );

        // Verify routine returned to idle state with updated last_run_unix
        let reg = registry.read().await;
        let r = reg.get("task1").unwrap();
        assert_eq!(r.state, RoutineState::Idle);
        assert_eq!(r.last_run_unix, Some(10));
    }

    #[tokio::test]
    async fn scheduler_immediate_execution_via_run_now() {
        let mut registry = RoutineRegistry::new();
        registry
            .register(Routine::new(
                "manual1",
                "Manual Routine",
                RoutineSchedule::Manual,
            ))
            .unwrap();

        let registry = Arc::new(RwLock::new(registry));
        let runner = Arc::new(MockRoutineRunner::new());
        let scheduler = RoutineScheduler::new(Arc::clone(&registry), runner.clone());

        // Manual routine is never due on tick
        let ticked = scheduler.tick_once(100).await;
        assert!(ticked.is_empty());

        // Run now triggers execution
        scheduler.run_now("manual1").await.unwrap();
        assert_eq!(runner.run_ids(), vec!["manual1".to_string()]);

        let reg = registry.read().await;
        let r = reg.get("manual1").unwrap();
        assert_eq!(r.state, RoutineState::Idle);
        assert!(r.last_run_unix.is_some());
    }

    #[tokio::test]
    async fn scheduler_pausing_and_resuming() {
        let mut registry = RoutineRegistry::new();
        registry
            .register(Routine::new(
                "task_pause",
                "Pausable Task",
                RoutineSchedule::IntervalSeconds(10),
            ))
            .unwrap();

        let registry = Arc::new(RwLock::new(registry));
        let runner = Arc::new(MockRoutineRunner::new());
        let scheduler = RoutineScheduler::new(Arc::clone(&registry), runner.clone());

        // Pause
        scheduler.pause("task_pause").await.unwrap();
        assert_eq!(runner.pause_ids(), vec!["task_pause".to_string()]);

        {
            let reg = registry.read().await;
            assert_eq!(reg.get("task_pause").unwrap().state, RoutineState::Paused);
        }

        // Ticking while paused does not run it
        let ticked = scheduler.tick_once(100).await;
        assert!(ticked.is_empty());
        assert!(runner.run_ids().is_empty());

        // Resume
        scheduler.resume("task_pause").await.unwrap();
        assert_eq!(runner.resume_ids(), vec!["task_pause".to_string()]);

        {
            let reg = registry.read().await;
            assert_eq!(reg.get("task_pause").unwrap().state, RoutineState::Idle);
        }

        // Now ticking runs it
        let ticked = scheduler.tick_once(100).await;
        assert_eq!(ticked, vec!["task_pause".to_string()]);
        assert_eq!(runner.run_ids(), vec!["task_pause".to_string()]);
    }

    #[tokio::test]
    async fn scheduler_graceful_stop() {
        let registry = Arc::new(RwLock::new(RoutineRegistry::new()));
        registry
            .write()
            .await
            .register(Routine::new(
                "task_stop",
                "Task Stop",
                RoutineSchedule::IntervalSeconds(60),
            ))
            .expect("registers");
        let runner = Arc::new(MockRoutineRunner::new());
        let scheduler = RoutineScheduler::new(registry, Arc::clone(&runner) as _);

        let handle = scheduler.start(std::time::Duration::from_millis(5));

        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if !runner.run_ids().is_empty() {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "scheduler background task never executed initial tick"
            );
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }

        scheduler.stop();
        let result = tokio::time::timeout(std::time::Duration::from_millis(200), handle).await;
        assert!(
            result.is_ok(),
            "scheduler background task should exit promptly after stop"
        );
    }

    #[test]
    fn unavailable_routine_runner_refuses_execution() {
        let runner = UnavailableRoutineRunner::new();
        let routine = Routine::new("nightly", "Nightly", RoutineSchedule::Manual);
        let err = runner.run(&routine).expect_err("unavailable runner must fail");
        assert!(err.to_string().contains("unavailable"));
    }
}
